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
  PURGE_RECORDS_JOB,
  PURGE_SCHEDULER_ID,
  SEARCH_INDEXING_QUEUE,
} from '../search.constants';
import { workersEnabled } from '../../../infrastructure/queue/worker-role';

/**
 * Registers the repeatable retention sweep. Deleting a record soft-deletes the
 * row so the indexer can remove the Meili document and so the deletion stays
 * auditable; without a purge those rows — each carrying a full JSONB document —
 * accumulate forever. The sweep only reclaims rows whose removal from Meili is
 * confirmed (`INDEXED`) and whose retention window has elapsed.
 *
 * Best-effort and idempotent for the same reasons as the reconciliation sweep.
 */
@Injectable()
export class SearchPurgeScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchPurgeScheduler.name);
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
    await this.schedulePurge(this.cfg.purgeEveryMs);
  }

  async schedulePurge(everyMs = this.cfg.purgeEveryMs): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        PURGE_SCHEDULER_ID,
        { every: everyMs },
        {
          name: PURGE_RECORDS_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log(
        `Registered search purge sweep (every ${everyMs}ms, retention ${this.cfg.purgeAfterDays}d)`,
      );
    } catch (error) {
      this.logger.warn(
        `Search purge registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
