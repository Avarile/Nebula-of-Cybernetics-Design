import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

/**
 * The document field that identifies a record in the search engine.
 *
 * `toMeiliDocument` always emits it, `fieldSpecToIndexDefinition` declares it,
 * and every document write passes it. It must be stated explicitly on writes:
 * a document also carries `externalId`, so leaving the engine to infer which
 * `*id` field is the key is ambiguous and fails the write permanently.
 */
export const RECORD_PRIMARY_KEY = 'id';

/** BullMQ queue that applies index mutations off the request path. */
export const SEARCH_INDEXING_QUEUE = QUEUE_NAMES.searchIndexing;

/**
 * Job: sync a batch of records (by id) to Meili. Live rows are added/replaced
 * and soft-deleted rows are removed, both derived from the current Postgres
 * state — so one job handles a mixed batch and is order-insensitive.
 */
export const INDEX_RECORDS_JOB = 'index-records';

/**
 * Job: sync a single record. Retained so jobs enqueued by an older deployment
 * are still consumed during a rolling upgrade; the processor treats it as a
 * one-element batch. New code should enqueue {@link INDEX_RECORDS_JOB}.
 *
 * @deprecated superseded by {@link INDEX_RECORDS_JOB}
 */
export const INDEX_RECORD_JOB = 'index-record';

/**
 * Job: delete a record's document from a collection's index. Also retained for
 * rolling-upgrade compatibility — {@link INDEX_RECORDS_JOB} already deletes
 * soft-deleted rows, since it reads their state from Postgres.
 *
 * @deprecated superseded by {@link INDEX_RECORDS_JOB}
 */
export const DELETE_RECORD_JOB = 'delete-record';

/** Job: clear a collection's index and reload every live record from Postgres. */
export const REINDEX_COLLECTION_JOB = 'reindex-collection';

/** Job: sweep for records that never converged and re-enqueue them. */
export const RECONCILE_JOB = 'reconcile';

/** Job: hard-delete soft-deleted records whose removal from Meili is confirmed. */
export const PURGE_RECORDS_JOB = 'purge-records';

/** Job: retry dropping a Meili index whose collection was already deleted. */
export const DROP_INDEX_JOB = 'drop-index';

/** Stable scheduler ids — `upsertJobScheduler` is keyed by these and idempotent. */
export const RECONCILE_SCHEDULER_ID = 'search-reconcile';
export const PURGE_SCHEDULER_ID = 'search-purge';

/** Redis pub/sub channel broadcasting collection-registry invalidations. */
export const REGISTRY_INVALIDATE_CHANNEL = 'search:registry:invalidate';
