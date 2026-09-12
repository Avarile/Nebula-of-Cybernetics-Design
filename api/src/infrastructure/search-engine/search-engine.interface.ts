/** Declarative index definition applied by `ensureIndex`. */
export interface IndexDefinition {
  name: string;
  primaryKey: string;
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
  rankingRules?: string[];
  maxTotalHits?: number; // pagination.maxTotalHits (default 1000)
}

/** A low-level query the engine understands. Filters are composed by callers. */
export interface EngineQuery {
  q: string;
  filter?: string | string[];
  sort?: string[];
  facets?: string[];
  page?: number;
  hitsPerPage?: number;
  attributesToHighlight?: string[];
  attributesToRetrieve?: string[];
}

/** Normalised search result independent of the backend response shape. */
export interface EngineResult<T> {
  hits: T[];
  totalHits: number;
  page: number;
  hitsPerPage: number;
  totalPages: number;
  facetDistribution?: Record<string, Record<string, number>>;
  processingTimeMs: number;
}

/**
 * Options for a document write.
 *
 * `primaryKey` must be supplied on every write. Without it the engine has to
 * *infer* which field identifies a document, and a payload carrying more than
 * one `*id` field (ours has `id` and `externalId`) makes that ambiguous — the
 * write then fails permanently, and an index auto-created by that write is left
 * without a primary key that nothing can repair afterwards. Passing it also
 * sets the key on an index that does not have one yet, so a broken index heals.
 */
export interface DocumentWriteOptions {
  primaryKey?: string;
}

/** Reference to an async engine task (Meili applies mutations asynchronously). */
export interface TaskRef {
  taskUid: number;
}

/** Raised when the engine errors or an async task fails. */
export class SearchEngineError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SearchEngineError';
  }
}

/** Index-agnostic search capability. Knows nothing about any domain. */
export interface SearchEngine {
  ensureIndex(def: IndexDefinition): Promise<void>;
  /**
   * Whether {@link ensureIndex} still has work to do — the index is missing, or
   * its attribute configuration no longer matches the definition. One cheap
   * read, no async task.
   */
  needsEnsure(def: IndexDefinition): Promise<boolean>;
  addOrReplace(
    index: string,
    docs: Array<Record<string, unknown>>,
    options?: DocumentWriteOptions,
  ): Promise<TaskRef>;
  update(
    index: string,
    docs: Array<Record<string, unknown>>,
    options?: DocumentWriteOptions,
  ): Promise<TaskRef>;
  deleteDocuments(index: string, ids: string[]): Promise<TaskRef>;
  deleteByFilter(index: string, filter: string | string[]): Promise<TaskRef>;
  clearIndex(index: string): Promise<TaskRef>;
  deleteIndex(index: string): Promise<TaskRef>;
  search<T = Record<string, unknown>>(
    index: string,
    query: EngineQuery,
  ): Promise<EngineResult<T>>;
  waitForTask(taskUid: number): Promise<void>;
  health(): Promise<boolean>;
}
