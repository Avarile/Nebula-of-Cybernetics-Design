import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Principal } from '../../common/principal';
import type { SearchConfig } from '../../config/configurations/search.config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import {
  SearchEngineError,
  type SearchEngine,
} from '../../infrastructure/search-engine/search-engine.interface';
import type { NewSearchRecordRow } from '../../infrastructure/database/schema/search.schema';
import { validateDocument } from './document-validator';
import { IndexRegistry, type CompiledCollection } from './index-registry';
import { resolveReadScope, type ReadScope } from './read-scope';
import { SearchMetrics } from './search.metrics';
import { SearchRecordRepository } from './search-record.repository';
import {
  INDEX_RECORDS_JOB,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from './search.constants';
import type {
  IndexState,
  SearchFilterValue,
  SearchRequest,
  SearchResults,
} from './search.types';
import { chunk, computeChecksum, INDEXING_JOB_OPTS } from './search.util';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Interval between convergence polls when a caller opts into `wait`. */
const WAIT_POLL_MS = 100;

export interface RecordInput {
  externalId?: string;
  document: Record<string, unknown>;
}

export interface PersistResult {
  id: string;
  externalId: string | null;
  indexState: IndexState;
}

export interface RecordView {
  id: string;
  externalId: string | null;
  document: Record<string, unknown>;
  indexState: IndexState;
  indexError: string | null;
  indexAttempts: number;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Owns record persistence and querying. Writes go to Postgres (source of truth)
 * then hand off to the async indexer; queries hit Meili only.
 *
 * Reads are authorized HERE, against the collection's own `visibility` policy —
 * not by the caller and not by a controller guard. Every read path
 * (`search`, `get`, and both agent tools) funnels through `requireReadScope`,
 * which is what stops the three call sites from drifting apart again.
 *
 * Writes remain admin-only at the controller (`RecordController`), which is why
 * `persist` may still trust the owner field in a caller-supplied document. If
 * record writes ever become user-facing, `persist` must instead FORCE the owner
 * field from the principal — otherwise a user could file a record under someone
 * else's id.
 *
 * The handoff is deliberately **non-fatal**: the row is already committed with
 * `indexState = 'PENDING'`, and the reconciliation sweep re-drives anything that
 * did not converge. Failing the request because Redis blinked would report a
 * write as lost when it is durably stored and will be indexed shortly.
 */
@Injectable()
export class SearchRecordService {
  private readonly logger = new Logger(SearchRecordService.name);
  private readonly cfg: SearchConfig;

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
    private readonly errors: ExceptionService,
    private readonly metrics: SearchMetrics,
  ) {
    this.cfg = config.getOrThrow<SearchConfig>('search');
  }

  /**
   * Validate, upsert atomically, then hand the touched ids to the indexer.
   *
   * @param wait when true, poll until every touched record has settled (or
   *   `waitTimeoutMs` elapses) and return the observed states — for importers
   *   and tests that query immediately afterwards.
   */
  async persist(
    collection: string,
    inputs: RecordInput[],
    wait = false,
  ): Promise<PersistResult[]> {
    const def = await this.requireCollection(collection);

    // Validate every document first — no partial writes on a bad record.
    for (const [i, input] of inputs.entries()) {
      const validationErrors = validateDocument(def.fields, input.document);
      // An owner-scoped record with no owner is unreadable by anyone but an
      // admin, so writing one is a silent data-loss bug rather than a subtle
      // policy question. Fail the write instead. (This is what stopped
      // document-ingest's `ownerUserId: meta.ownerId ?? ''` from landing.)
      if (def.visibility === 'owner_scoped' && def.ownerField) {
        const owner = input.document[def.ownerField];
        // The owner field may be a single id or, for an ACL-scoped collection,
        // an array of permitted ids. Both must be non-empty for the same
        // reason: an empty scope is a record nobody but an admin can ever read.
        const isSingle = typeof owner === 'string' && owner.length > 0;
        const isList =
          Array.isArray(owner) &&
          owner.length > 0 &&
          owner.every((v) => typeof v === 'string' && v.length > 0);
        if (!isSingle && !isList) {
          validationErrors.push(
            `Collection "${collection}" is owner-scoped, so "${def.ownerField}" must be a non-empty string or a non-empty array of strings`,
          );
        }
      }
      if (validationErrors.length) {
        throw this.errors.validation(
          validationErrors.map((m) => ({ path: `records[${i}]`, message: m })),
          { message: `Record ${i} failed validation` },
        );
      }
    }

    // Later entries win, so one payload can carry a record twice without
    // tripping Postgres's "cannot affect row a second time" on the upsert.
    const deduped = dedupeByExternalId(inputs);

    const withKey = deduped.filter((r) => r.externalId);
    const existing = await this.records.findLiveByExternalIds(
      collection,
      withKey.map((r) => r.externalId as string),
    );
    const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

    // Plan first, write once. Each entry keeps its slot so the returned array
    // stays parallel to `deduped` without depending on RETURNING order.
    type Plan =
      | { kind: 'skip'; result: PersistResult }
      | { kind: 'write'; externalId: string | null; id: string };
    const plans: Plan[] = [];
    const rows: NewSearchRecordRow[] = [];
    const handedOff = new Date();

    for (const input of deduped) {
      const externalId = input.externalId ?? null;
      const checksum = computeChecksum(externalId, input.document);
      const prior = externalId ? byExternalId.get(externalId) : undefined;

      // Unchanged content that Meili already serves: nothing to write, nothing
      // to index. This is what makes re-ingest of an unchanged upstream free.
      if (
        prior &&
        prior.checksum === checksum &&
        prior.indexState === 'INDEXED'
      ) {
        plans.push({
          kind: 'skip',
          result: {
            id: prior.id,
            externalId: prior.externalId,
            indexState: prior.indexState,
          },
        });
        continue;
      }

      // Ids are minted here rather than left to the column default, so a fresh
      // insert's id is known before the write. On conflict the existing row
      // keeps its own id, recovered from `written` by business key.
      const id = prior?.id ?? randomUUID();
      plans.push({ kind: 'write', externalId, id });
      rows.push({
        id,
        collection,
        externalId,
        document: input.document,
        checksum,
        indexState: 'PENDING',
        indexError: null,
        indexAttemptedAt: handedOff,
        indexAttempts: 0,
      });
    }

    const written = await this.records.upsertMany(rows);
    const writtenByExternalId = new Map(
      written
        .filter((row) => row.externalId !== null)
        .map((row) => [row.externalId, row]),
    );

    const results = plans.map<PersistResult>((plan) => {
      if (plan.kind === 'skip') return plan.result;
      const row = plan.externalId
        ? writtenByExternalId.get(plan.externalId)
        : undefined;
      return {
        id: row?.id ?? plan.id,
        externalId: plan.externalId,
        indexState: row?.indexState ?? 'PENDING',
      };
    });

    const ids = results
      .filter((_, i) => plans[i].kind === 'write')
      .map((r) => r.id);
    await this.enqueueIndexJobs(collection, ids);
    if (!wait || ids.length === 0) return results;
    return this.awaitConvergence(results, ids);
  }

  async remove(collection: string, key: string): Promise<void> {
    await this.requireCollection(collection);
    const row = await this.resolveRow(collection, key);
    await this.records.softDelete(row.id);
    // The indexer reads the row's current state, so the same job that indexes a
    // live record removes a soft-deleted one. No separate delete job needed.
    await this.enqueueIndexJobs(collection, [row.id]);
  }

  /**
   * Read one record from Postgres (source of truth). Resolves by id or externalId.
   *
   * Enforces the same read policy as {@link search}. It has to: this path
   * returns the whole `document` straight from Postgres, and for the
   * `documents` collection the `externalId` is the caller-visible `fileId`, so
   * an unscoped read here would hand over another user's extracted text just as
   * effectively as an unscoped query.
   */
  async get(
    collection: string,
    key: string,
    principal: Principal,
  ): Promise<RecordView> {
    const def = await this.requireCollection(collection);
    const scope = this.requireReadScope(def, principal);
    const row = await this.resolveRow(collection, key);
    if (scope.ownerFilter) {
      const owner = row.document[scope.ownerFilter.field];
      if (owner !== scope.ownerFilter.userId) {
        // NOT_FOUND, not FORBIDDEN: whether a record exists under a given
        // externalId is itself owner-scoped information.
        throw this.errors.create(ErrorCode.SEARCH_RECORD_NOT_FOUND);
      }
    }
    return toRecordView(row);
  }

  async reload(collection: string): Promise<void> {
    await this.requireCollection(collection);
    await this.queue.add(
      REINDEX_COLLECTION_JOB,
      { collection },
      INDEXING_JOB_OPTS,
    );
  }

  async search<T = Record<string, unknown>>(
    collection: string,
    request: SearchRequest,
    principal: Principal,
  ): Promise<SearchResults<T>> {
    const def = await this.requireCollection(collection);
    const scope = this.requireReadScope(def, principal);
    const hitsPerPage = Math.min(
      request.limit ?? this.cfg.defaultPageSize,
      this.cfg.maxPageSize,
    );
    // Meili caps deep pagination at `pagination.maxTotalHits`; past that a page
    // comes back empty and `totalHits` saturates, which is indistinguishable
    // from "no more results". Say so instead of lying by omission.
    const maxPage = Math.ceil(this.cfg.maxTotalHits / hitsPerPage);
    if (request.page > maxPage) {
      throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
        message:
          `Page ${request.page} is beyond the index ceiling of ` +
          `${this.cfg.maxTotalHits} hits (max page ${maxPage} at ${hitsPerPage} per page). ` +
          `Narrow the query with filters rather than paging deeper.`,
      });
    }
    const filter = this.buildFilter(def, request.filters);
    if (scope.ownerFilter) {
      // Appended, and therefore non-negotiable: Meili ANDs the elements of a
      // `filter` array, so a caller cannot OR their way past it, and a
      // conflicting owner filter of their own just yields nothing.
      filter.push(
        toFilterClause(scope.ownerFilter.field, scope.ownerFilter.userId),
      );
    }
    const sort = this.buildSort(def, request.sort);

    try {
      const result = await this.engine.search<T>(collection, {
        q: request.q,
        filter: filter.length ? filter : undefined,
        sort: sort.length ? sort : undefined,
        facets: this.pickFacets(def, request.facets),
        page: request.page,
        hitsPerPage,
        attributesToHighlight: request.highlight,
      });
      return {
        hits: result.hits,
        page: result.page,
        limit: result.hitsPerPage,
        totalHits: result.totalHits,
        totalPages: result.totalPages,
        facetDistribution: result.facetDistribution,
        processingTimeMs: result.processingTimeMs,
      };
    } catch (error) {
      if (error instanceof SearchEngineError) {
        this.logger.warn(`Search failed on "${collection}": ${error.message}`);
        throw this.errors.create(ErrorCode.SEARCH_UNAVAILABLE, {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Hand ids to the indexer in batches. A failure here is logged and counted,
   * never thrown: the rows are committed `PENDING` and the reconciliation sweep
   * owns recovery.
   */
  private async enqueueIndexJobs(
    collection: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    for (const batch of chunk(ids, this.cfg.indexBatchSize)) {
      try {
        await this.queue.add(
          INDEX_RECORDS_JOB,
          { collection, ids: batch },
          INDEXING_JOB_OPTS,
        );
      } catch (error) {
        this.metrics.increment('enqueueFailure');
        this.logger.warn(
          `Index handoff failed for ${batch.length} record(s) in "${collection}" — ` +
            `left PENDING for the reconciliation sweep: ${asMessage(error)}`,
        );
      }
    }
  }

  /** Poll until every id has left PENDING, or the configured ceiling elapses. */
  private async awaitConvergence(
    results: PersistResult[],
    ids: string[],
  ): Promise<PersistResult[]> {
    const deadline = Date.now() + this.cfg.waitTimeoutMs;
    const settled = new Map<string, IndexState>();
    while (Date.now() < deadline && settled.size < ids.length) {
      await sleep(WAIT_POLL_MS);
      for (const row of await this.records.findByIds(ids)) {
        if (row.indexState !== 'PENDING') settled.set(row.id, row.indexState);
      }
    }
    return results.map((r) => ({
      ...r,
      indexState: settled.get(r.id) ?? r.indexState,
    }));
  }

  /** Resolve a record by uuid or business key, scoped to the collection. */
  private async resolveRow(collection: string, key: string) {
    let row = UUID_RE.test(key) ? await this.records.findLiveById(key) : null;
    if (!row) row = await this.records.findLiveByExternalId(collection, key);
    if (!row || row.collection !== collection) {
      throw this.errors.create(ErrorCode.SEARCH_RECORD_NOT_FOUND);
    }
    return row;
  }

  /**
   * Apply the collection's read policy, or refuse.
   *
   * Every read path goes through here, so a new caller cannot accidentally
   * inherit the old "reads are global" behaviour by forgetting to filter.
   */
  private requireReadScope(
    def: CompiledCollection,
    principal: Principal,
  ): Extract<ReadScope, { allowed: true }> {
    const scope = resolveReadScope(def, principal);
    if (!scope.allowed) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `You do not have access to collection "${def.name}"`,
      });
    }
    return scope;
  }

  private async requireCollection(name: string): Promise<CompiledCollection> {
    const def = await this.registry.resolve(name);
    if (!def) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    return def;
  }

  private buildFilter(
    def: CompiledCollection,
    filters?: Record<string, SearchFilterValue>,
  ): string[] {
    const clauses: string[] = [];
    for (const [field, value] of Object.entries(filters ?? {})) {
      if (!def.definition.filterableAttributes.includes(field)) {
        throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
          message: `Unknown filter field "${field}"`,
        });
      }
      clauses.push(toFilterClause(field, value));
    }
    return clauses;
  }

  /**
   * Parse `field:asc|desc`, exactly.
   *
   * `split(':')` accepted `a:b:c` by taking the first two segments and dropping
   * the rest. It failed closed on the direction, so this was never an injection
   * — but the filter/sort builders are the boundary against Meili expression
   * injection, and a boundary should reject malformed input rather than
   * silently reinterpret it.
   */
  private buildSort(def: CompiledCollection, sort?: string[]): string[] {
    if (!sort) return [];
    return sort.map((entry) => {
      const parts = entry.split(':');
      const [field, dir] = parts;
      if (
        parts.length !== 2 ||
        !field ||
        !def.definition.sortableAttributes.includes(field) ||
        (dir !== 'asc' && dir !== 'desc')
      ) {
        throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
          message: `Invalid sort "${entry}" (expected "field:asc" or "field:desc")`,
        });
      }
      return `${field}:${dir}`;
    });
  }

  private pickFacets(
    def: CompiledCollection,
    facets?: string[],
  ): string[] | undefined {
    if (!facets) return undefined;
    const invalid = facets.filter(
      (f) => !def.definition.filterableAttributes.includes(f),
    );
    if (invalid.length) {
      throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
        message: `Unknown facet(s): ${invalid.join(', ')}`,
      });
    }
    return facets;
  }
}

/**
 * Collapse duplicate business keys, keeping the last occurrence. Records without
 * an `externalId` are always distinct inserts and pass through untouched.
 */
function dedupeByExternalId(inputs: RecordInput[]): RecordInput[] {
  const keyed = new Map<string, RecordInput>();
  const unkeyed: RecordInput[] = [];
  for (const input of inputs) {
    if (input.externalId) keyed.set(input.externalId, input);
    else unkeyed.push(input);
  }
  return [...keyed.values(), ...unkeyed];
}

/** Map a DB row to the API record view. */
function toRecordView(row: {
  id: string;
  externalId: string | null;
  document: Record<string, unknown>;
  indexState: IndexState;
  indexError: string | null;
  indexAttempts: number;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RecordView {
  return {
    id: row.id,
    externalId: row.externalId,
    document: row.document,
    indexState: row.indexState,
    indexError: row.indexError,
    indexAttempts: row.indexAttempts,
    indexedAt: row.indexedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Quote + escape a string value for a Meili filter expression. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Build one Meili filter clause from a validated field/value pair. */
function toFilterClause(field: string, value: SearchFilterValue): string {
  if (Array.isArray(value)) {
    const list = value
      .map((v) => (typeof v === 'number' ? String(v) : quote(String(v))))
      .join(', ');
    return `${field} IN [${list}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${field} = ${value}`;
  }
  return `${field} = ${quote(value)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
