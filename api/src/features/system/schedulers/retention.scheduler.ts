import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  haltWorkerIfApiOnly,
  workersEnabled,
} from '../../../infrastructure/queue/worker-role';
import { RetentionPurgeRegistry } from '../../../infrastructure/retention/retention.registry';
import { RetentionService } from '../retention.service';
import { SystemEventRepository } from '../system-event.repository';
import { SystemEventService } from '../system-event.service';
import {
  RETENTION_EVERY_MS,
  RETENTION_SCHEDULER_ID,
  RETENTION_SWEEP_JOB,
  SYSTEM_RETENTION_QUEUE,
} from '../system.constants';

/**
 * Registers the repeatable retention sweep, plus the purge for the one table
 * this module owns.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(
    @InjectQueue(SYSTEM_RETENTION_QUEUE) private readonly queue: Queue,
    private readonly registry: RetentionPurgeRegistry,
    private readonly events: SystemEventRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Only the table this module owns. `activity_log` registers itself from
    // `ActivityService`, so the sweep never imports the feature modules whose
    // rows it deletes.
    this.registry.register('system_event_log', (cutoff, limit) =>
      this.events.purgeOlderThan(cutoff, limit),
    );

    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    try {
      // Keyed by a stable id, so re-registering on every boot updates in place
      // instead of orphaning repeatables in Redis.
      await this.queue.upsertJobScheduler(
        RETENTION_SCHEDULER_ID,
        { every: RETENTION_EVERY_MS },
        {
          name: RETENTION_SWEEP_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log(
        `Registered retention sweep (every ${RETENTION_EVERY_MS}ms)`,
      );
    } catch (error) {
      // Boot must never hard-require Redis; a missed sweep is not urgent.
      this.logger.warn(
        `Retention sweep registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Consumes the sweep. Split from the scheduler so each has one job. */
@Processor(SYSTEM_RETENTION_QUEUE)
export class RetentionProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly events: SystemEventService,
  ) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(): Promise<void> {
    const startedAt = Date.now();
    const results = await this.retention.runAll();
    const deleted = results.reduce((sum, r) => sum + r.deleted, 0);
    const failed = results.filter((r) => r.status === 'failed');
    const skipped = results.filter((r) => r.status === 'skipped');

    await this.events.emit({
      severity:
        failed.length > 0 ? 'error' : skipped.length > 0 ? 'warn' : 'info',
      source: 'retention.processor',
      eventKey: 'retention.sweep.completed',
      message:
        `Retention sweep deleted ${deleted} row(s) across ${results.length} policy(ies)` +
        (skipped.length > 0 ? `; ${skipped.length} skipped (no handler)` : '') +
        (failed.length > 0 ? `; ${failed.length} failed` : ''),
      payload: { results },
      durationMs: Date.now() - startedAt,
    });
  }
}
