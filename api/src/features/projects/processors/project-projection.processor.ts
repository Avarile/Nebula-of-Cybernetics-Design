import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { haltWorkerIfApiOnly } from '../../../infrastructure/queue/worker-role';
import {
  DEPROJECT_PROJECT_JOB,
  PROJECT_PROJECTION_QUEUE,
  REPROJECT_PROJECT_JOB,
} from '../project.constants';
import { ProjectProjectionService } from '../project-projection.service';

/**
 * Applies a project's per-task index fan-out off the request path.
 *
 * Membership is the scope array for a project AND every task beneath it, so
 * adding one member invalidates every task's index document. Done inline that
 * was linear in the project's size inside the HTTP request that triggered it —
 * ~32 ms per task, so roughly half a minute for a thousand-task project, all
 * while holding a connection from a pool shared with the other workers.
 *
 * Each job re-reads the current rows from Postgres rather than trusting a
 * payload snapshot, so two rapid membership changes converge on the later state
 * instead of racing. A throw is left to BullMQ's retries, after which the search
 * reconciliation sweep picks up whatever is still unindexed.
 */
@Processor(PROJECT_PROJECTION_QUEUE)
export class ProjectProjectionProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(ProjectProjectionProcessor.name);

  constructor(private readonly projection: ProjectProjectionService) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case REPROJECT_PROJECT_JOB:
        return this.projection.reprojectProjectAndTasks(
          this.requireString(job, 'projectId', job.data?.projectId),
        );
      case DEPROJECT_PROJECT_JOB:
        return this.projection.removeTasks(
          this.requireIds(job, job.data?.taskIds),
        );
      default:
        this.logger.warn(`Ignoring unknown job "${job.name}"`);
    }
  }

  private requireString(job: Job, field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      // Throwing would retry a payload that can never become valid.
      throw new Error(`Job ${job.id} (${job.name}) is missing "${field}"`);
    }
    return value;
  }

  private requireIds(job: Job, value: unknown): string[] {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      throw new Error(`Job ${job.id} (${job.name}) has a malformed id list`);
    }
    return value as string[];
  }
}
