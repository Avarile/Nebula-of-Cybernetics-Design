import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import type { Queue } from 'bullmq';
import {
  AGENT_RUN_JOB_OPTS,
  AGENT_RUN_QUEUE,
  RUN_SCHEDULE_JOB,
} from '../mastra.constants';
import { isValidCron } from '../cron.util';
import { ScheduleRepository } from '../repositories/schedule.repository';

export interface CreateScheduleInput {
  name: string;
  cron: string;
  agentId: string;
  promptTemplate: string;
  timezone?: string;
  params?: Record<string, unknown>;
  description?: string;
  deliveryChannel?: string;
  deliveryTarget?: string;
  targetUserId?: string;
  enabled?: boolean;
}

/**
 * Registers/unregisters BullMQ job schedulers for admin-managed agent schedules.
 *
 * CONFIRMED (`node_modules/bullmq` `dist/esm/classes/queue.d.ts` L193-198,
 * installed version 5.80.2): `upsertJobScheduler(jobSchedulerId: NameType,
 * repeatOpts: Omit<RepeatOptions, 'key'>, jobTemplate?: { name?: NameType;
 * data?: DataType; opts?: JobSchedulerTemplateOptions }): Promise<Job<...>>`
 * is idempotent — calling it again with the same `jobSchedulerId` updates the
 * existing scheduler rather than creating a duplicate, which is what makes
 * `syncRepeatableJobs()` safe to re-run on every boot. `removeJobScheduler
 * (jobSchedulerId: string): Promise<boolean>` (L293) removes by id alone, so
 * unlike the old `removeRepeatable(name, repeatOpts, jobId?)` there is no need
 * to replay the original repeat options to unregister the cron entry.
 *
 * `RepeatOptions` (`dist/esm/interfaces/repeat-options.d.ts`) exposes both
 * `pattern` (cron string, parsed via `cron-parser`) and `every` (fixed-interval
 * ms) as mutually exclusive fields — `search-reconciliation.scheduler.ts` uses
 * `every` for its fixed sweep interval; this service uses `pattern` because
 * agent schedules are defined by admin-supplied cron expressions. `tz` (also
 * from `Omit<ParserOptions, 'iterator'>`) carries the schedule's timezone into
 * the cron parser.
 *
 * `JobSchedulerTemplateOptions` (`dist/esm/types/job-scheduler-template-
 * options.d.ts`) is `Omit<JobsOptions, 'jobId' | 'repeat' | 'delay' |
 * 'deduplication' | 'debounce'>` — `AGENT_RUN_JOB_OPTS` (`attempts`,
 * `backoff`, `removeOnComplete`, `removeOnFail`) uses none of the excluded
 * fields, so it plugs into `opts` without a cast.
 */
@Injectable()
export class ScheduleService {
  private readonly schedulesEnabled: boolean;

  constructor(
    private readonly repo: ScheduleRepository,
    @InjectQueue(AGENT_RUN_QUEUE) private readonly queue: Queue,
    config: ConfigService,
    private readonly errors: ExceptionService,
  ) {
    this.schedulesEnabled =
      config.getOrThrow<MastraConfig>('mastra').schedulesEnabled;
  }

  private async register(s: { id: string; cron: string; timezone?: string }) {
    await this.queue.upsertJobScheduler(
      s.id,
      { pattern: s.cron, tz: s.timezone },
      {
        name: RUN_SCHEDULE_JOB,
        data: { scheduleId: s.id },
        opts: AGENT_RUN_JOB_OPTS,
      },
    );
  }

  /**
   * Validate the cron expression BEFORE persisting.
   *
   * `upsertJobScheduler` parses the pattern and throws on a bad one — but it ran
   * after the row was inserted, so a typo left a persisted schedule that failed
   * registration here and then failed again in `syncRepeatableJobs()` on every
   * subsequent boot. Parsing first keeps the row and the scheduler consistent.
   */
  private assertValidCron(cron: string): void {
    if (!isValidCron(cron)) {
      throw this.errors.create(ErrorCode.VALIDATION_FAILED, {
        message: `Invalid cron expression "${cron}" (expected 5 or 6 fields, e.g. "0 9 * * *")`,
      });
    }
  }

  async create(dto: CreateScheduleInput) {
    this.assertValidCron(dto.cron);
    const row = await this.repo.create(dto as never);
    // The kill-switch used to guard only the boot-time sync, so creating a
    // schedule registered a live repeatable even with MASTRA_SCHEDULES_ENABLED
    // false — the switch survived exactly until the first admin used the API.
    if (row.enabled && this.schedulesEnabled) await this.register(row);
    return row;
  }

  async syncRepeatableJobs() {
    if (!this.schedulesEnabled) return;
    const rows = await this.repo.listEnabled();
    for (const r of rows) await this.register(r);
  }

  async remove(id: string) {
    await this.repo.softDelete(id);
    await this.queue.removeJobScheduler(id);
  }
}
