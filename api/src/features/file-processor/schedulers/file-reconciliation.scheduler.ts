import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { FILE_PROCESSING_QUEUE, FILE_RECONCILE_JOB } from '../file.constants';
import { workersEnabled } from '../../../infrastructure/queue/worker-role';

/** Default cadence for the file reconciliation sweep. */
const FILE_RECONCILE_EVERY_MS = 3_600_000;

/**
 * Registers the repeatable reconciliation sweep (expire stale PENDING rows,
 * purge unreferenced objects) on startup.
 *
 * This used to expose `scheduleReconciliation` for an "ops/bootstrap hook to
 * call once Redis is available" — but nothing ever called it, so the sweep never
 * ran. Registration happens here instead, wrapped so a Redis outage degrades to
 * "no sweep this boot" rather than blocking startup, and via
 * `upsertJobScheduler` (keyed by a stable id) so re-registering on every boot is
 * idempotent instead of orphaning stale repeatables in Redis.
 */
@Injectable()
export class FileReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FileReconciliationScheduler.name);

  constructor(
    @InjectQueue(FILE_PROCESSING_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    await this.scheduleReconciliation();
  }

  async scheduleReconciliation(
    everyMs = FILE_RECONCILE_EVERY_MS,
  ): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'file-reconcile',
        { every: everyMs },
        {
          name: FILE_RECONCILE_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log(
        `Registered file reconciliation sweep (every ${everyMs}ms)`,
      );
    } catch (error) {
      this.logger.warn(
        `File reconciliation registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
