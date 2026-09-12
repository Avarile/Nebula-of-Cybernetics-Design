import { Injectable } from '@nestjs/common';

/** Counter names tracked for the indexing pipeline. */
export type SearchCounter =
  | 'indexSuccess' // records successfully applied to Meili
  | 'indexFailure' // records that failed an index attempt
  | 'enqueueFailure' // handoffs to Redis that failed (repaired by the sweep)
  | 'reconcileRequeued' // records the sweep handed back to the indexer
  | 'purged' // soft-deleted rows reclaimed
  | 'indexRecreated'; // Meili indexes rebuilt because they had vanished

const ZERO: Record<SearchCounter, number> = {
  indexSuccess: 0,
  indexFailure: 0,
  enqueueFailure: 0,
  reconcileRequeued: 0,
  purged: 0,
  indexRecreated: 0,
};

/**
 * Process-local counters for the Postgres → Meili pipeline. Deliberately not a
 * Prometheus client: the repo has no metrics exporter, and inventing one here
 * would be a larger dependency decision than this change owns. These are
 * exposed on the admin sync-status endpoint, so the numbers are per-instance
 * and reset on restart — the durable truth always lives in `search_records`
 * (`index_state`, `index_attempts`, `index_error`), which the same endpoint
 * reports alongside them.
 */
@Injectable()
export class SearchMetrics {
  private counters: Record<SearchCounter, number> = { ...ZERO };
  private readonly startedAt = new Date();

  increment(counter: SearchCounter, by = 1): void {
    this.counters[counter] += by;
  }

  snapshot(): Record<SearchCounter, number> & { since: Date } {
    return { ...this.counters, since: this.startedAt };
  }

  /** Test seam only. */
  reset(): void {
    this.counters = { ...ZERO };
  }
}
