import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';
import type { SearchConfig } from '../../../config/configurations/search.config';
import { SEARCH_ENGINE } from '../../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../../infrastructure/search-engine/search-engine.interface';
import type { SearchRecordRow } from '../../../infrastructure/database/schema/search.schema';
import { haltWorkerIfApiOnly } from '../../../infrastructure/queue/worker-role';
import { IndexRegistry } from '../index-registry';
import { SearchMetrics } from '../search.metrics';
import { SearchRecordRepository } from '../search-record.repository';
import {
  DELETE_RECORD_JOB,
  DROP_INDEX_JOB,
  INDEX_RECORD_JOB,
  INDEX_RECORDS_JOB,
  PURGE_RECORDS_JOB,
  RECONCILE_JOB,
  RECORD_PRIMARY_KEY,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from '../search.constants';
import { chunk, INDEXING_JOB_OPTS, toMeiliDocument } from '../search.util';

const REINDEX_PAGE_SIZE = 500;

/**
 * Applies index mutations off the request path. Every job reads the current rows
 * from Postgres (the source of truth) so Meili converges to the latest state,
 * rapid updates coalesce, and a mixed batch of live and soft-deleted records is
 * handled by one job. Success stamps `INDEXED`; a throw stamps `FAILED` and
 * rethrows so BullMQ retries, after which the reconciliation sweep takes over.
 *
 * Concurrency is configured because `waitForTask` parks the worker for the whole
 * duration of a Meili task; the default of 1 would serialize the entire pipeline
 * behind a single in-flight batch.
 */
@Processor(SEARCH_INDEXING_QUEUE)
export class SearchIndexingProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(SearchIndexingProcessor.name);
  private readonly cfg: SearchConfig;
  /** Collections whose Meili settings this process has already converged. */
  private readonly ensured = new Set<string>();

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
    private readonly metrics: SearchMetrics,
  ) {
    super();
    this.cfg = config.getOrThrow<SearchConfig>('search');
  }

  /**
   * `@Processor` is evaluated at class-definition time, before ConfigService
   * exists, so concurrency is applied here instead of in the decorator — this
   * keeps it on the validated-config path like every other tunable.
   */
  onModuleInit(): void {
    if (haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m))) return;
    if (this.worker) this.worker.concurrency = this.cfg.indexConcurrency;
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case INDEX_RECORDS_JOB:
        return this.indexRecords(
          this.requireString(job, 'collection', job.data?.collection),
          this.requireIds(job, job.data?.ids),
        );
      // Legacy single-record jobs, kept so a rolling deploy drains whatever the
      // previous version left in Redis. Both reduce to a one-element batch.
      case INDEX_RECORD_JOB:
      case DELETE_RECORD_JOB: {
        const id = this.requireString(job, 'id', job.data?.id);
        const row = await this.records.findById(id);
        if (!row) return;
        return this.indexRecords(row.collection, [id]);
      }
      case REINDEX_COLLECTION_JOB:
        return this.reindexCollection(
          this.requireString(job, 'collection', job.data?.collection),
        );
      case RECONCILE_JOB:
        return this.reconcile();
      case PURGE_RECORDS_JOB:
        return this.purge();
      case DROP_INDEX_JOB:
        return this.dropIndex(
          this.requireString(job, 'collection', job.data?.collection),
        );
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  /**
   * Converge a batch of records. Live rows are added/replaced and soft-deleted
   * rows removed, both derived from current Postgres state — so the caller never
   * has to say which operation it wants.
   */
  private async indexRecords(collection: string, ids: string[]): Promise<void> {
    const rows = await this.records.findByIds(ids);
    if (rows.length === 0) return;
    const live = rows.filter((r) => !r.isDeleted);
    const gone = rows.filter((r) => r.isDeleted);

    try {
      await this.ensureIndexReady(collection);
      if (live.length) {
        const { taskUid } = await this.engine.addOrReplace(
          collection,
          live.map(toMeiliDocument),
          { primaryKey: RECORD_PRIMARY_KEY },
        );
        await this.engine.waitForTask(taskUid);
      }
      if (gone.length) {
        const { taskUid } = await this.engine.deleteDocuments(
          collection,
          gone.map((r) => r.id),
        );
        await this.engine.waitForTask(taskUid);
      }
      const touched = rows.map((r) => r.id);
      await this.records.markIndexStateMany(touched, 'INDEXED', {
        indexedAt: new Date(),
        indexError: null,
      });
      this.metrics.increment('indexSuccess', touched.length);
    } catch (error) {
      // The whole batch is marked FAILED: Meili applies a document batch as one
      // task, so a failure tells us nothing about individual documents. The
      // retry re-reads every row, so over-marking costs a redundant write, while
      // under-marking would lose a record.
      await this.records.markIndexStateMany(
        rows.map((r) => r.id),
        'FAILED',
        { indexError: asMessage(error) },
      );
      this.metrics.increment('indexFailure', rows.length);
      throw error;
    }
  }

  /**
   * Guarantee the collection's index exists *with its configured settings*
   * before writing. Without this, a Meili volume wiped while the app is running
   * gets an index auto-created by `addDocuments` with default settings: writes
   * succeed, records stamp INDEXED, and every filter and sort then fails at
   * query time.
   *
   * A per-process memo alone is not sufficient, and this is not theoretical —
   * the e2e test for exactly this scenario failed with "Attribute `status` is
   * not filterable" while the memo was the only check. An index can lose its
   * configuration *after* it has been ensured, so the configuration is verified
   * every time (one cheap read, no async task) while applying settings — the
   * expensive part — stays memoised.
   */
  private async ensureIndexReady(collection: string): Promise<void> {
    const def = await this.registry.resolve(collection);
    if (!def) return; // collection deleted mid-flight; nothing to configure
    const alreadyEnsured = this.ensured.has(collection);
    if (alreadyEnsured && !(await this.engine.needsEnsure(def.definition))) {
      return;
    }
    await this.engine.ensureIndex(def.definition);
    this.ensured.add(collection);
    if (alreadyEnsured) this.metrics.increment('indexRecreated');
  }

  /**
   * Clear a collection's index and reload every live record from Postgres.
   *
   * KNOWN AVAILABILITY COST: between the `clearIndex` below and the last page
   * being written, queries against this collection return nothing. For a large
   * collection that is a visible outage window, not a blip.
   *
   * Not fixed here on purpose. The fix is to build into a second index and
   * `swapIndexes`, which changes what `redriveReloadRacers` has to reason about
   * (writers race the *shadow* index, not the live one) and needs its own
   * design pass. Reload is an admin-triggered repair, so the exposure is
   * bounded and deliberate rather than routine — but it is real, and this note
   * is here so the next person does not discover it from a graph.
   */
  private async reindexCollection(collection: string): Promise<void> {
    // Settings first, so a reload is a complete repair and not documents-only.
    const def = await this.registry.resolve(collection);
    if (def) await this.engine.ensureIndex(def.definition);
    this.ensured.add(collection);

    // Every record this pass indexes is stamped with this one timestamp, which
    // makes concurrent writers identifiable afterwards: their `indexedAt` is
    // strictly newer. See the re-drive at the end.
    const startedAt = new Date();

    const cleared = await this.engine.clearIndex(collection);
    await this.engine.waitForTask(cleared.taskUid);

    let afterId: string | null = null;
    let total = 0;
    for (;;) {
      const page: SearchRecordRow[] = await this.records.pageLiveByCollection(
        collection,
        REINDEX_PAGE_SIZE,
        afterId,
      );
      if (page.length === 0) break;
      const added = await this.engine.addOrReplace(
        collection,
        page.map(toMeiliDocument),
        { primaryKey: RECORD_PRIMARY_KEY },
      );
      await this.engine.waitForTask(added.taskUid);
      // Stamp only what this pass actually wrote. Marking the whole collection
      // would also mark records persisted *during* the rebuild — which this
      // pass never saw, and whose own jobs may still be pending or have failed.
      // Claiming convergence for those hides a genuinely unindexed record.
      await this.records.markIndexStateMany(
        page.map((row) => row.id),
        'INDEXED',
        { indexedAt: startedAt, indexError: null },
      );
      total += page.length;
      afterId = page[page.length - 1].id;
      if (page.length < REINDEX_PAGE_SIZE) break;
    }
    this.metrics.increment('indexSuccess', total);
    this.logger.log(`Reindexed "${collection}" with ${total} documents`);
    await this.redriveReloadRacers(collection, startedAt);
  }

  /**
   * Re-drive records that converged while a reload was rebuilding the index.
   *
   * A reload is `clearIndex` followed by a repage of Postgres, so a record
   * written concurrently can be indexed by its own job and then wiped by the
   * clear, while its row still says INDEXED. The reconciliation sweep only
   * looks at unconverged records, so nothing else would ever notice — the
   * document would simply be missing from search until the next reload.
   */
  private async redriveReloadRacers(
    collection: string,
    startedAt: Date,
  ): Promise<void> {
    const racers = await this.records.findConvergedAfter(
      collection,
      startedAt,
      this.cfg.reconcileBatch,
    );
    if (racers.length === 0) return;
    for (const batch of chunk(
      racers.map((row) => row.id),
      this.cfg.indexBatchSize,
    )) {
      await this.queue.add(
        INDEX_RECORDS_JOB,
        { collection, ids: batch },
        INDEXING_JOB_OPTS,
      );
    }
    this.logger.log(
      `Re-driving ${racers.length} record(s) in "${collection}" that were written during the reload`,
    );
  }

  /**
   * Drift repair. Re-drives every record that never converged, oldest attempt
   * first, grouped into batched jobs per collection. This is what makes the
   * pipeline at-least-once: a lost handoff, a Redis flush, or a Meili outage
   * that outlasted the job's retries all land here.
   */
  private async reconcile(): Promise<void> {
    const rows = await this.records.findUnsynced(this.cfg.reconcileBatch, {
      staleMs: this.cfg.reconcileStaleMs,
      maxBackoffMs: this.cfg.reconcileMaxBackoffMs,
    });
    if (rows.length === 0) return;

    const byCollection = new Map<string, string[]>();
    for (const row of rows) {
      const ids = byCollection.get(row.collection) ?? [];
      ids.push(row.id);
      byCollection.set(row.collection, ids);
    }

    let requeued = 0;
    for (const [collection, ids] of byCollection) {
      for (const batch of chunk(ids, this.cfg.indexBatchSize)) {
        await this.queue.add(
          INDEX_RECORDS_JOB,
          { collection, ids: batch },
          INDEXING_JOB_OPTS,
        );
        requeued += batch.length;
      }
    }
    this.metrics.increment('reconcileRequeued', requeued);

    const stuck = rows.filter(
      (r) => r.indexAttempts >= this.cfg.maxIndexAttempts,
    );
    if (stuck.length) {
      this.logger.error(
        `${stuck.length} record(s) have failed >= ${this.cfg.maxIndexAttempts} index attempts ` +
          `and need operator attention (e.g. ${stuck[0].collection}/${stuck[0].id}: ${stuck[0].indexError ?? 'no error recorded'})`,
      );
    }
    this.logger.log(
      `Reconcile re-enqueued ${requeued} record(s) across ${byCollection.size} collection(s)`,
    );
  }

  /** Reclaim soft-deleted rows whose removal from Meili has been confirmed. */
  private async purge(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.cfg.purgeAfterDays * 24 * 60 * 60 * 1000,
    );
    const removed = await this.records.purgeSoftDeleted(
      cutoff,
      this.cfg.purgeBatch,
    );
    if (removed === 0) return;
    this.metrics.increment('purged', removed);
    this.logger.log(`Purged ${removed} soft-deleted record(s)`);
  }

  /**
   * Retry dropping the Meili index of an already-deleted collection. Only once
   * the drop is observed do its soft-deleted rows count as converged — that is
   * what stops the reconciliation sweep from re-driving per-record deletes
   * against an index that no longer exists.
   */
  private async dropIndex(collection: string): Promise<void> {
    const { taskUid } = await this.engine.deleteIndex(collection);
    await this.engine.waitForTask(taskUid);
    this.ensured.delete(collection);
    await this.records.markCollectionPurged(collection);
    this.logger.log(`Dropped index "${collection}"`);
  }

  private requireString(job: Job, field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `Job "${job.name}": "${field}" must be a non-empty string`,
      );
    }
    return value;
  }

  private requireIds(job: Job, value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((v) => typeof v !== 'string' || v.length === 0)
    ) {
      throw new Error(
        `Job "${job.name}": "ids" must be a non-empty array of strings`,
      );
    }
    return value as string[];
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
