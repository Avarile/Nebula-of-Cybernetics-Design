import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { MeiliSearch } from 'meilisearch';
import { MEILI_CLIENT } from '../search-engine/meili.constants';
import { SearchStatusService } from '../../features/search-service/search-status.service';

/**
 * Terminus health indicator for search. Reports `down` when MeiliSearch is
 * unreachable *or* when the indexing pipeline has fallen behind: a live Meili
 * serving a stale read model is a real outage from a caller's point of view,
 * and the previous liveness-only check stayed green while records piled up
 * unindexed.
 *
 * The status service is optional so the indicator still works when the health
 * module is booted without the search feature (as focused e2e tests do).
 */
@Injectable()
export class MeiliHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(MEILI_CLIENT) private readonly client: MeiliSearch,
    @Optional() private readonly status?: SearchStatusService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const healthy = await this.client.isHealthy();
      if (!healthy) {
        return indicator.down({ message: 'meilisearch not healthy' });
      }
      if (!this.status) return indicator.up();

      // Cached: this runs on every readiness probe, and uncached it is a full
      // aggregate over the largest table in the schema.
      const stats = await this.status.cachedStats();
      const lagSeconds = this.status.lagSeconds(stats);
      const detail = {
        lagSeconds,
        pending: stats.pending,
        failed: stats.failed,
      };
      return this.status.isDegraded(stats)
        ? indicator.down({
            message: `search index lagging by ${lagSeconds}s`,
            ...detail,
          })
        : indicator.up(detail);
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
