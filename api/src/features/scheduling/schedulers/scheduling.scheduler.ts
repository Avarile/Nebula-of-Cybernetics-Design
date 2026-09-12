import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import type { SchedulingConfig } from '../../../config/configurations/scheduling.config';
import {
  haltWorkerIfApiOnly,
  workersEnabled,
} from '../../../infrastructure/queue/worker-role';
import { DispatcherService } from '../dispatcher.service';
import { MaterializerService } from '../materializer.service';
import { ReaperService } from '../reaper.service';
import {
  MATERIALIZE_JOB,
  MATERIALIZE_SCHEDULER_ID,
  POLL_TICK_JOB,
  POLL_TICK_SCHEDULER_ID,
  REAP_JOB,
  REAP_SCHEDULER_ID,
  SCHEDULING_QUEUE,
} from '../scheduling.constants';

/**
 * Registers the three repeatables that drive the poller.
 *
 * BullMQ is used here as a **cron trigger only** — the jobs it carries have no
 * payload and no meaning. `scheduled_job` stays the source of truth, which is
 * what makes the design survive a Redis flush: the pending rows never went
 * anywhere, so recovery after downtime is automatic rather than a restore.
 *
 * It is also what makes the eventual retrofit cheap. If handlers get slow
 * enough that ten concurrent slots inside an eight-second tick is not enough
 * throughput, `DispatcherService.execute` swaps `handler(...)` for
 * `queue.add(..., { jobId: job.dedupeKey })` and the staleness check moves into
 * the worker. Starting queue-first and adding a table later is the direction
 * that costs a migration you cannot backfill, because the history was never
 * written down.
 */
@Injectable()
export class SchedulingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulingScheduler.name);
  private readonly config: SchedulingConfig;

  constructor(
    @InjectQueue(SCHEDULING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<SchedulingConfig>('scheduling');
  }

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    if (this.config.tickBudgetMs >= this.config.tickIntervalMs) {
      // Not fatal, but it guarantees overlapping ticks under any backlog, and
      // the symptom (the poller competing with itself for the same rows) is
      // much harder to read than this line.
      this.logger.warn(
        `SCHEDULER_TICK_BUDGET_MS (${this.config.tickBudgetMs}) is not below ` +
          `SCHEDULER_TICK_INTERVAL_MS (${this.config.tickIntervalMs}) — ticks will overlap`,
      );
    }

    // Keyed by stable ids, so re-registering on every boot updates in place
    // instead of orphaning repeatables in Redis.
    await this.register(
      POLL_TICK_SCHEDULER_ID,
      { every: this.config.tickIntervalMs },
      POLL_TICK_JOB,
    );
    await this.register(
      REAP_SCHEDULER_ID,
      { every: this.config.reapIntervalMs },
      REAP_JOB,
    );
    await this.register(
      MATERIALIZE_SCHEDULER_ID,
      { pattern: this.config.materializeCron },
      MATERIALIZE_JOB,
    );
  }

  private async register(
    id: string,
    repeat: { every: number } | { pattern: string },
    name: string,
  ): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(id, repeat, {
        name,
        data: {},
        opts: { removeOnComplete: true, removeOnFail: true },
      });
      this.logger.log(`Registered "${name}" (${JSON.stringify(repeat)})`);
    } catch (error) {
      // Boot must never hard-require Redis. A missed tick is recoverable — the
      // pending rows are still in Postgres — and refusing to start would turn a
      // cache outage into a full outage.
      this.logger.warn(
        `Scheduler "${name}" registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Consumes the three triggers. Split from the scheduler so each has one job.
 *
 * Concurrency is deliberately left at BullMQ's default of one: the tick does
 * its own bounded fan-out internally, and a second concurrent tick would only
 * compete with the first for the same rows and the same pg connections.
 */
@Processor(SCHEDULING_QUEUE)
export class SchedulingProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SchedulingProcessor.name);

  constructor(
    private readonly dispatcher: DispatcherService,
    private readonly reaper: ReaperService,
    private readonly materializer: MaterializerService,
  ) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case POLL_TICK_JOB:
        return this.dispatcher.tick();
      case REAP_JOB:
        return this.reaper.run();
      case MATERIALIZE_JOB:
        return this.materializer.run();
      default:
        // A name nobody handles means work is being produced that nothing
        // consumes; failing loudly is the only way that surfaces.
        throw new Error(`Unknown scheduling job "${job.name}"`);
    }
  }
}
