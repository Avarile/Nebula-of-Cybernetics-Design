import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SearchConfig } from '../../config/configurations/search.config';
import { SearchMetrics, type SearchCounter } from './search.metrics';
import { SearchRecordRepository } from './search-record.repository';
import type { SyncStats } from './search.types';

/**
 * How long the health probe may reuse a stats snapshot. Short enough that a
 * genuine backlog still surfaces promptly, long enough that probe traffic stops
 * driving repeated full-table aggregates.
 */
const STATS_CACHE_MS = 15_000;

/** One unconverged record, as surfaced to an operator. */
export interface UnsyncedRecordView {
  id: string;
  externalId: string | null;
  indexState: string;
  indexAttempts: number;
  indexError: string | null;
  indexAttemptedAt: Date | null;
  updatedAt: Date;
}

export interface SyncStatusView {
  collection: string | null;
  counts: { pending: number; indexed: number; failed: number };
  /** Seconds since the least-recently-attempted unconverged record was tried. */
  lagSeconds: number;
  /** True when lag exceeds SEARCH_LAG_ALERT_SECONDS — the sweep is not keeping up. */
  degraded: boolean;
  /** Highest attempt count among unconverged records. */
  maxAttempts: number;
  /** Records past SEARCH_MAX_INDEX_ATTEMPTS need a human, not another retry. */
  stuckThreshold: number;
  worstOffenders: UnsyncedRecordView[];
  counters: Record<SearchCounter, number> & { since: Date };
}

/**
 * Answers "is the Postgres → Meili pipeline healthy?". The durable signal is the
 * `search_records` state itself, so counts and lag are read from the table
 * rather than from process counters — a restart cannot hide a backlog.
 */
@Injectable()
export class SearchStatusService {
  private readonly cfg: SearchConfig;
  private statsCache: { value: SyncStats; expiresAt: number } | null = null;

  constructor(
    private readonly records: SearchRecordRepository,
    private readonly metrics: SearchMetrics,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<SearchConfig>('search');
  }

  /** Raw stats, shared with the health indicator. */
  async stats(collection?: string): Promise<SyncStats> {
    return this.records.syncStats(collection);
  }

  /**
   * Cached whole-table stats for the health probe.
   *
   * `syncStats()` is four filtered aggregates plus a `min`/`max` over
   * `search_records` — the largest table in the schema. The readiness probe ran
   * it unconditionally, so a 10s Kubernetes probe across N replicas turned into
   * a constant sequential-scan-shaped load, and a slow Postgres failed the
   * *Meili* indicator. Lag moves on the scale of the reconcile interval
   * (60s by default), so a few seconds of staleness costs nothing.
   */
  async cachedStats(): Promise<SyncStats> {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache.value;
    }
    const value = await this.stats();
    this.statsCache = { value, expiresAt: now + STATS_CACHE_MS };
    return value;
  }

  /** Seconds the oldest unconverged record has waited since its last attempt. */
  lagSeconds(stats: SyncStats): number {
    if (!stats.oldestUnsyncedAt) return 0;
    return Math.max(
      0,
      Math.round((Date.now() - stats.oldestUnsyncedAt.getTime()) / 1000),
    );
  }

  isDegraded(stats: SyncStats): boolean {
    return this.lagSeconds(stats) > this.cfg.lagAlertSeconds;
  }

  async status(collection?: string): Promise<SyncStatusView> {
    const stats = await this.stats(collection);
    const worstOffenders = collection
      ? await this.records.findUnsyncedByCollection(collection, 20)
      : [];
    return {
      collection: collection ?? null,
      counts: {
        pending: stats.pending,
        indexed: stats.indexed,
        failed: stats.failed,
      },
      lagSeconds: this.lagSeconds(stats),
      degraded: this.isDegraded(stats),
      maxAttempts: stats.maxAttempts,
      stuckThreshold: this.cfg.maxIndexAttempts,
      worstOffenders: worstOffenders.map((row) => ({
        id: row.id,
        externalId: row.externalId,
        indexState: row.indexState,
        indexAttempts: row.indexAttempts,
        indexError: row.indexError,
        indexAttemptedAt: row.indexAttemptedAt,
        updatedAt: row.updatedAt,
      })),
      counters: this.metrics.snapshot(),
    };
  }
}
