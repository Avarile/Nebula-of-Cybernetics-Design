import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  searchRecords,
  type NewSearchRecordRow,
  type SearchRecordRow,
} from '../../infrastructure/database/schema/search.schema';
import type { IndexState, SyncStats } from './search.types';

/**
 * Never let an index-state stamp move `updatedAt`. `baseColumns.updatedAt` has
 * `$onUpdate`, which Drizzle applies to any column absent from `.set()`, so
 * without this the INDEXED stamp would bump `updatedAt` *after* the Meili
 * document was built — making `updatedAt > indexedAt` permanently true and
 * drift undetectable. Assigning the column to itself is a no-op write that
 * suppresses `$onUpdate` deterministically.
 */
const KEEP_UPDATED_AT = sql`${searchRecords.updatedAt}`;

/** Normalise a value that may arrive as a pg timestamp string. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/** Repository for the `search_records` table. */
@Injectable()
export class SearchRecordRepository extends BaseRepository<
  typeof searchRecords
> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, searchRecords);
  }

  /** A live (non-deleted) record by id. */
  async findLiveById(id: string): Promise<SearchRecordRow | null> {
    const rows = await this.db
      .select()
      .from(searchRecords)
      .where(and(eq(searchRecords.id, id), eq(searchRecords.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** A live record by its (collection, externalId) business key. */
  async findLiveByExternalId(
    collection: string,
    externalId: string,
  ): Promise<SearchRecordRow | null> {
    const rows = await this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.externalId, externalId),
          eq(searchRecords.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Live records for a batch of business keys — one round-trip for a persist call. */
  async findLiveByExternalIds(
    collection: string,
    externalIds: string[],
  ): Promise<SearchRecordRow[]> {
    if (externalIds.length === 0) return [];
    return this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          eq(searchRecords.collection, collection),
          inArray(searchRecords.externalId, externalIds),
          eq(searchRecords.isDeleted, false),
        ),
      );
  }

  /** Rows for a batch of ids, soft-deleted included (the indexer needs both). */
  async findByIds(ids: string[]): Promise<SearchRecordRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(searchRecords)
      .where(inArray(searchRecords.id, ids));
  }

  /**
   * Atomically insert-or-update a batch, keyed by the partial unique index on
   * `(collection, externalId)`. One statement, so the batch is all-or-nothing —
   * a mid-batch failure can never leave a partially written set of records.
   *
   * Callers MUST dedupe by `(collection, externalId)` first: Postgres rejects an
   * `ON CONFLICT DO UPDATE` that would touch the same row twice in one statement.
   */
  async upsertMany(rows: NewSearchRecordRow[]): Promise<SearchRecordRow[]> {
    if (rows.length === 0) return [];
    return this.db.transaction(async (tx) =>
      tx
        .insert(searchRecords)
        .values(rows)
        .onConflictDoUpdate({
          target: [searchRecords.collection, searchRecords.externalId],
          targetWhere: sql`${searchRecords.externalId} IS NOT NULL AND ${searchRecords.isDeleted} = false`,
          set: {
            document: sql`excluded.document`,
            checksum: sql`excluded.checksum`,
            indexState: sql`excluded.index_state`,
            indexError: sql`excluded.index_error`,
            indexAttemptedAt: sql`excluded.index_attempted_at`,
            // New content earns a fresh attempt budget; `indexedAt` is left as
            // history so `updatedAt > indexedAt` still reads as "drifted".
            indexAttempts: sql`excluded.index_attempts`,
            updatedAt: sql`now()`,
          },
        })
        .returning(),
    );
  }

  /** Stamp sync state for one record. Counts as an attempt; never moves `updatedAt`. */
  async markIndexState(
    id: string,
    state: IndexState,
    patch: { indexError?: string | null; indexedAt?: Date | null } = {},
  ): Promise<void> {
    await this.markIndexStateMany([id], state, patch);
  }

  /**
   * Stamp sync state for a whole batch in one UPDATE.
   *
   * `indexAttempts` counts *failures*, not stamps. It used to increment on every
   * call including successes, so a record was charged an attempt each time it
   * was re-indexed — by a reload, by `reconcileCollection`, by the reload-racer
   * re-drive. Two things then broke for records that had never actually failed:
   * the sweep's backoff is `staleMs × 2^attempts`, so after ~10 reloads a single
   * later failure parked the record at the hour-long ceiling instead of retrying
   * in minutes; and `reconcile()` reported it as "needs operator attention" past
   * `SEARCH_MAX_INDEX_ATTEMPTS`. Converging resets the counter, so the budget
   * measures consecutive failures.
   */
  async markIndexStateMany(
    ids: string[],
    state: IndexState,
    patch: { indexError?: string | null; indexedAt?: Date | null } = {},
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(searchRecords)
      .set({
        indexState: state,
        indexAttemptedAt: new Date(),
        indexAttempts:
          state === 'INDEXED' ? 0 : sql`${searchRecords.indexAttempts} + 1`,
        ...(patch.indexError !== undefined
          ? { indexError: patch.indexError }
          : {}),
        ...(patch.indexedAt !== undefined
          ? { indexedAt: patch.indexedAt }
          : {}),
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(inArray(searchRecords.id, ids));
  }

  /**
   * Soft-delete a record and hand it back to the indexer. `indexAttemptedAt` is
   * stamped here because this *is* the handoff, so the sweep measures staleness
   * from the moment of the delete rather than from a NULL.
   */
  async softDelete(id: string): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        indexState: 'PENDING',
        indexError: null,
        indexAttemptedAt: new Date(),
        indexAttempts: 0,
      })
      .where(eq(searchRecords.id, id));
  }

  /** Keyset page of live records for a collection, ordered by id (reload source). */
  async pageLiveByCollection(
    collection: string,
    limit: number,
    afterId: string | null,
  ): Promise<SearchRecordRow[]> {
    const conditions = [
      eq(searchRecords.collection, collection),
      eq(searchRecords.isDeleted, false),
    ];
    if (afterId) conditions.push(gt(searchRecords.id, afterId));
    return this.db
      .select()
      .from(searchRecords)
      .where(and(...conditions))
      .orderBy(asc(searchRecords.id))
      .limit(limit);
  }

  /**
   * Live records in a collection that converged *after* `since`. Used to find
   * the writers that raced a full reload: the reload stamps everything it
   * indexed with its own start time, so anything strictly newer converged
   * during the rebuild and may have been wiped by the reload's `clearIndex`.
   */
  async findConvergedAfter(
    collection: string,
    since: Date,
    limit: number,
  ): Promise<SearchRecordRow[]> {
    return this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.isDeleted, false),
          gt(searchRecords.indexedAt, since),
        ),
      )
      .limit(limit);
  }

  /**
   * Soft-delete a collection's records (used when the collection is deleted).
   * They are left `PENDING`, not `INDEXED`: dropping the Meili index may fail,
   * and claiming convergence we have not observed would hide those documents
   * from the sweep that is supposed to remove them.
   */
  async softDeleteByCollection(collection: string): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        indexState: 'PENDING',
        indexError: null,
        indexAttemptedAt: new Date(),
        indexAttempts: 0,
      })
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.isDeleted, false),
        ),
      );
  }

  /**
   * Mark a deleted collection's soft-deleted rows as converged. Called only
   * after the Meili index drop is *observed* to succeed — that drop removes
   * every document at once, so the per-record deletes the sweep would otherwise
   * issue are redundant. Until then the rows stay `PENDING` on purpose.
   */
  async markCollectionPurged(collection: string): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({
        indexState: 'INDEXED',
        indexedAt: new Date(),
        indexError: null,
        indexAttemptedAt: new Date(),
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.isDeleted, true),
          ne(searchRecords.indexState, 'INDEXED'),
        ),
      );
  }

  /**
   * Records that never converged and are due for a retry, oldest attempt first.
   *
   * The wait before a retry doubles with each failed attempt — `staleMs`,
   * `2 × staleMs`, `4 × staleMs`… capped at `maxBackoffMs` — so a record that
   * can never succeed (a malformed document, a misconfigured index) stops
   * consuming a retry every few minutes and stops repeating its error in the
   * log. It is never abandoned, only slowed down.
   *
   * The `indexState <> 'INDEXED'` shape matches `search_records_unsynced_idx`
   * exactly, so the per-row backoff expression is only ever evaluated over
   * unconverged rows. The NULL branch catches rows written by a path that never
   * stamped a handoff time.
   */
  async findUnsynced(
    limit: number,
    backoff: { staleMs: number; maxBackoffMs: number },
  ): Promise<SearchRecordRow[]> {
    // `least(indexAttempts, 20)` bounds the exponent before `power` is
    // evaluated, so a long-stuck row cannot overflow the double.
    const dueAt = sql`now() - interval '1 millisecond' * least(
      ${backoff.staleMs}::double precision * power(2, least(${searchRecords.indexAttempts}, 20)),
      ${backoff.maxBackoffMs}::double precision
    )`;
    return this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          ne(searchRecords.indexState, 'INDEXED'),
          or(
            isNull(searchRecords.indexAttemptedAt),
            sql`${searchRecords.indexAttemptedAt} < ${dueAt}`,
          ),
        ),
      )
      .orderBy(sql`${searchRecords.indexAttemptedAt} ASC NULLS FIRST`)
      .limit(limit);
  }

  /** Sync-health counters. `collection` omitted = across every collection. */
  async syncStats(collection?: string): Promise<SyncStats> {
    const scope = collection
      ? eq(searchRecords.collection, collection)
      : undefined;
    const [row] = await this.db
      .select({
        pending: sql<number>`count(*) filter (where ${searchRecords.indexState} = 'PENDING')::int`,
        indexed: sql<number>`count(*) filter (where ${searchRecords.indexState} = 'INDEXED')::int`,
        failed: sql<number>`count(*) filter (where ${searchRecords.indexState} = 'FAILED')::int`,
        oldestUnsyncedAt: sql<Date | null>`min(${searchRecords.indexAttemptedAt}) filter (where ${searchRecords.indexState} <> 'INDEXED')`,
        maxAttempts: sql<number>`coalesce(max(${searchRecords.indexAttempts}) filter (where ${searchRecords.indexState} <> 'INDEXED'), 0)::int`,
      })
      .from(searchRecords)
      .where(scope);
    return {
      pending: row?.pending ?? 0,
      indexed: row?.indexed ?? 0,
      failed: row?.failed ?? 0,
      // Drizzle only applies a column's type mapper to that column, never to a
      // raw aggregate over it, so `min(...)` arrives as a pg timestamp string.
      oldestUnsyncedAt: toDate(row?.oldestUnsyncedAt),
      maxAttempts: row?.maxAttempts ?? 0,
    };
  }

  /** Worst offenders first (most index attempts), for the admin status view. */
  async findUnsyncedByCollection(
    collection: string,
    limit: number,
  ): Promise<SearchRecordRow[]> {
    return this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          eq(searchRecords.collection, collection),
          ne(searchRecords.indexState, 'INDEXED'),
        ),
      )
      .orderBy(sql`${searchRecords.indexAttempts} DESC`)
      .limit(limit);
  }

  /**
   * Hard-delete soft-deleted records whose removal from Meili is confirmed and
   * whose retention window has elapsed. Bounded by a subquery because Postgres
   * has no `DELETE ... LIMIT`. Returns the number of rows reclaimed.
   */
  async purgeSoftDeleted(cutoff: Date, limit: number): Promise<number> {
    const doomed = this.db
      .select({ id: searchRecords.id })
      .from(searchRecords)
      .where(
        and(
          eq(searchRecords.isDeleted, true),
          eq(searchRecords.indexState, 'INDEXED'),
          lt(searchRecords.deletedAt, cutoff),
        ),
      )
      .orderBy(asc(searchRecords.deletedAt))
      .limit(limit);
    const deleted = await this.db
      .delete(searchRecords)
      .where(inArray(searchRecords.id, doomed))
      .returning({ id: searchRecords.id });
    return deleted.length;
  }
}
