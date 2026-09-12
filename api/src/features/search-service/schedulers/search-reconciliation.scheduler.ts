import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { SearchConfig } from '../../../config/configurations/search.config';
import {
  RECONCILE_JOB,
  RECONCILE_SCHEDULER_ID,
  SEARCH_INDEXING_QUEUE,
} from '../search.constants';
import { workersEnabled } from '../../../infrastructure/queue/worker-role';

/**
 * Registers the repeatable drift-repair sweep on startup. This is the component
 * that makes the pipeline at-least-once: Postgres is the source of truth and
 * Meili is a rebuildable read model, so anything that failed to converge —
 * a handoff lost to a Redis outage, a process killed between commit and enqueue,
 * a Meili outage that outlasted a job's retries — is re-driven from here.
 *
 * Registration is best-effort so booting never hard-requires Redis, and uses
 * `upsertJobScheduler` (keyed by a stable id) rather than `add({ repeat })`:
 * upsert is idempotent, so re-registering on every boot updates the existing
 * scheduler in place instead of orphaning stale repeatables in Redis.
 */
@Injectable()
export class SearchReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchReconciliationScheduler.name);
  private readonly cfg: SearchConfig;

  constructor(
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<SearchConfig>('search');
  }

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    await this.scheduleReconciliation(this.cfg.reconcileEveryMs);
  }

  async scheduleReconciliation(
    everyMs = this.cfg.reconcileEveryMs,
  ): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        RECONCILE_SCHEDULER_ID,
        { every: everyMs },
        {
          name: RECONCILE_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log(
        `Registered search reconciliation sweep (every ${everyMs}ms)`,
      );
    } catch (error) {
      this.logger.warn(
        `Search reconciliation registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
