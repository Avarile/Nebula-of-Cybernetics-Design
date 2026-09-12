import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import type { SearchConfig } from '../../config/configurations/search.config';
import { MEILI_CLIENT } from './meili.constants';
import {
  SearchEngineError,
  type DocumentWriteOptions,
  type EngineQuery,
  type EngineResult,
  type IndexDefinition,
  type SearchEngine,
  type TaskRef,
} from './search-engine.interface';

/**
 * MeiliSearch-backed implementation of {@link SearchEngine}. All MeiliSearch SDK
 * specifics are confined to this file — everything above it is index-agnostic.
 * Mutations return the async task ref so callers can await consistency.
 */
/**
 * Stand-in task id for "nothing to do". `waitForTask` returns immediately for
 * it, so a no-op reads like a completed task to every caller.
 */
export const NO_TASK = -1;

@Injectable()
export class SearchEngineService implements SearchEngine {
  private readonly logger = new Logger(SearchEngineService.name);
  private readonly prefix: string;
  private readonly taskTimeoutMs: number;
  private readonly maxTotalHits: number;

  constructor(
    @Inject(MEILI_CLIENT) private readonly client: MeiliSearch,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<SearchConfig>('search');
    this.prefix = cfg.indexPrefix;
    this.taskTimeoutMs = cfg.taskTimeoutMs;
    this.maxTotalHits = cfg.maxTotalHits;
  }

  private uid(index: string): string {
    return `${this.prefix}${index}`;
  }

  async ensureIndex(def: IndexDefinition): Promise<void> {
    const uid = this.uid(def.name);
    try {
      const task = await this.client.createIndex(uid, {
        primaryKey: def.primaryKey,
      });
      await this.waitForTask(task.taskUid);
    } catch (error) {
      if (!this.isAlreadyExists(error)) throw this.wrap(error);
      // The index predates this call, so `createIndex` did not get to set its
      // primary key. It may not have one at all.
      await this.repairPrimaryKey(uid, def.primaryKey);
    }
    const settings = await this.client.index(uid).updateSettings({
      searchableAttributes: def.searchableAttributes,
      filterableAttributes: def.filterableAttributes,
      sortableAttributes: def.sortableAttributes,
      ...(def.rankingRules ? { rankingRules: def.rankingRules } : {}),
      // Caps deep pagination: pages beyond this ceiling return nothing and
      // `totalHits` saturates, so it is configured rather than hardcoded and is
      // validated against SEARCH_MAX_PAGE_SIZE at startup.
      pagination: { maxTotalHits: def.maxTotalHits ?? this.maxTotalHits },
    });
    await this.waitForTask(settings.taskUid);
  }

  /**
   * Detects both ways an index can stop being usable: it is gone, or it exists
   * with the wrong attribute configuration.
   *
   * Checking mere existence is not enough. A document write against a missing
   * index makes the engine create one with *default* settings, and that write
   * succeeds — so records stamp INDEXED while every filter and sort fails at
   * query time. Comparing settings costs the same single read and catches it.
   */
  async needsEnsure(def: IndexDefinition): Promise<boolean> {
    try {
      const settings = await this.client
        .index(this.uid(def.name))
        .getSettings();
      return (
        !matches(settings.filterableAttributes, def.filterableAttributes) ||
        !matches(settings.sortableAttributes, def.sortableAttributes) ||
        !matches(settings.searchableAttributes, def.searchableAttributes)
      );
    } catch (error) {
      if (errorCode(error) === 'index_not_found') return true;
      throw this.wrap(error);
    }
  }

  async addOrReplace(
    index: string,
    docs: Array<Record<string, unknown>>,
    options?: DocumentWriteOptions,
  ): Promise<TaskRef> {
    const task = await this.client
      .index(this.uid(index))
      .addDocuments(docs, options);
    return { taskUid: task.taskUid };
  }

  async update(
    index: string,
    docs: Array<Record<string, unknown>>,
    options?: DocumentWriteOptions,
  ): Promise<TaskRef> {
    const task = await this.client
      .index(this.uid(index))
      .updateDocuments(docs, options);
    return { taskUid: task.taskUid };
  }

  /** Delete documents. A missing index means they are already gone. */
  async deleteDocuments(index: string, ids: string[]): Promise<TaskRef> {
    try {
      const task = await this.client
        .index(this.uid(index))
        .deleteDocuments(ids);
      return { taskUid: task.taskUid };
    } catch (error) {
      if (errorCode(error) === 'index_not_found') return { taskUid: NO_TASK };
      throw this.wrap(error);
    }
  }

  async deleteByFilter(
    index: string,
    filter: string | string[],
  ): Promise<TaskRef> {
    const task = await this.client
      .index(this.uid(index))
      .deleteDocuments({ filter });
    return { taskUid: task.taskUid };
  }

  async clearIndex(index: string): Promise<TaskRef> {
    const task = await this.client.index(this.uid(index)).deleteAllDocuments();
    return { taskUid: task.taskUid };
  }

  /**
   * Drop an index. Absent is success.
   *
   * Meili fails the task with `index_not_found` when the index is already gone,
   * which `waitForTask` turned into a thrown error. That is the desired end
   * state, but it left the collection's soft-deleted rows PENDING forever: the
   * drop job exhausted its retries, the reconciliation sweep re-drove per-record
   * deletes against a non-existent index, and `purgeSoftDeleted` (which requires
   * INDEXED) could never reclaim them.
   */
  async deleteIndex(index: string): Promise<TaskRef> {
    try {
      const task = await this.client.deleteIndex(this.uid(index));
      return { taskUid: task.taskUid };
    } catch (error) {
      if (errorCode(error) === 'index_not_found') return { taskUid: NO_TASK };
      throw this.wrap(error);
    }
  }

  async search<T = Record<string, unknown>>(
    index: string,
    query: EngineQuery,
  ): Promise<EngineResult<T>> {
    const res = (await this.client.index(this.uid(index)).search(query.q, {
      filter: query.filter,
      sort: query.sort,
      facets: query.facets,
      page: query.page,
      hitsPerPage: query.hitsPerPage,
      attributesToHighlight: query.attributesToHighlight,
      attributesToRetrieve: query.attributesToRetrieve,
    })) as {
      hits: T[];
      totalHits?: number;
      estimatedTotalHits?: number;
      totalPages?: number;
      hitsPerPage?: number;
      page?: number;
      facetDistribution?: Record<string, Record<string, number>>;
      processingTimeMs?: number;
    };
    return {
      hits: res.hits,
      totalHits: res.totalHits ?? res.estimatedTotalHits ?? res.hits.length,
      page: res.page ?? query.page ?? 1,
      hitsPerPage: res.hitsPerPage ?? query.hitsPerPage ?? res.hits.length,
      totalPages: res.totalPages ?? 1,
      facetDistribution: res.facetDistribution,
      processingTimeMs: res.processingTimeMs ?? 0,
    };
  }

  async waitForTask(taskUid: number): Promise<void> {
    // Sentinel from an operation that found nothing to do — there is no task to
    // wait for, and polling for it would 404.
    if (taskUid === NO_TASK) return;
    // meilisearch@0.45.0: client.tasks.waitForTask(uid, { timeOutMs, intervalMs }).
    // The returned Task carries `.status` and `.error` (verified against the
    // installed 0.45.0 type definitions).
    const task = await this.client.tasks.waitForTask(taskUid, {
      timeOutMs: this.taskTimeoutMs,
    });
    if (task.status !== 'succeeded') {
      throw new SearchEngineError(
        `Meili task ${taskUid} ${task.status}: ${task.error?.message ?? 'unknown error'}`,
        task.error?.code,
      );
    }
  }

  async health(): Promise<boolean> {
    try {
      return await this.client.isHealthy();
    } catch {
      return false;
    }
  }

  /**
   * Give an existing index the primary key it should have.
   *
   * An index auto-created by a document write has no primary key, and nothing
   * else can add one afterwards: `createIndex` is a no-op once the index exists
   * and `updateSettings` does not cover the primary key. Every subsequent write
   * then fails on ambiguous inference, forever.
   *
   * Best-effort by design. Meili refuses the change while the index holds
   * documents — but in that case it already has a working key, so warning and
   * carrying on is strictly better than failing a write that would succeed.
   */
  private async repairPrimaryKey(
    uid: string,
    primaryKey: string,
  ): Promise<void> {
    try {
      const info = await this.client.index(uid).getRawInfo();
      if (info.primaryKey === primaryKey) return;
      const task = await this.client.updateIndex(uid, { primaryKey });
      await this.waitForTask(task.taskUid);
      this.logger.log(
        `Set primary key "${primaryKey}" on index "${uid}" (was ${
          info.primaryKey === null ? 'unset' : `"${info.primaryKey}"`
        })`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not set primary key "${primaryKey}" on index "${uid}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private isAlreadyExists(error: unknown): boolean {
    return errorCode(error) === 'index_already_exists';
  }

  private wrap(error: unknown): SearchEngineError {
    const e = error as { message?: string };
    return new SearchEngineError(
      e?.message ?? 'search engine error',
      errorCode(error),
    );
  }
}

/**
 * Whether the engine's attribute list is EXACTLY what the definition requires.
 *
 * Set equality, not coverage. Accepting a superset meant a narrowing change
 * never converged: drop `filterable` from a field and the attribute stayed
 * filterable in Meili indefinitely, because the old configuration still
 * "covered" the new spec. Since the filterable list is also the query
 * allowlist, that left a field queryable after the spec said it should not be.
 */
function matches(
  actual: string[] | null | undefined,
  required: string[],
): boolean {
  // A default-settings index reports `["*"]` for searchable attributes, which is
  // never what a declared spec asks for.
  if (actual?.length === 1 && actual[0] === '*') return required.length === 0;
  const have = new Set(actual ?? []);
  if (have.size !== required.length) return false;
  return required.every((attribute) => have.has(attribute));
}

/**
 * Read a MeiliSearch error code from either shape it arrives in.
 *
 * `createIndex` returns a task that *fails*, which `waitForTask` converts into a
 * `SearchEngineError` carrying `code` directly. A synchronous REST rejection
 * instead throws a `MeiliSearchApiError`, whose code sits at `cause.code` — its
 * own enumerable keys are only `name`, `cause`, `response`. Reading just `.code`
 * silently misses the second case, which is how a deleted index was reported as
 * an unexpected failure rather than as "not found".
 */
function errorCode(error: unknown): string | undefined {
  const e = error as {
    code?: string;
    cause?: { code?: string };
  } | null;
  return e?.code ?? e?.cause?.code;
}
