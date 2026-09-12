import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced search-engine config (MeiliSearch connection + search policy +
 * indexing-pipeline tuning). Consumed by the search-engine infrastructure
 * module, the Meili health indicator, and the search-service feature.
 */
export const searchConfig = registerAs('search', () => {
  const env = validateEnv(process.env);
  const scheme = env.MEILISEARCH_USE_SSL ? 'https' : 'http';
  return {
    host: `${scheme}://${env.MEILISEARCH_HOST}:${env.MEILISEARCH_PORT}`,
    apiKey: env.MEILISEARCH_MASTER_KEY,
    indexPrefix: env.MEILISEARCH_INDEX_PREFIX,
    taskTimeoutMs: env.MEILISEARCH_TASK_TIMEOUT_MS,
    searchTimeoutMs: env.MEILISEARCH_SEARCH_TIMEOUT_MS,
    defaultPageSize: env.SEARCH_DEFAULT_PAGE_SIZE,
    maxPageSize: env.SEARCH_MAX_PAGE_SIZE,
    maxTotalHits: env.SEARCH_MAX_TOTAL_HITS,

    // Indexing pipeline: Postgres is the source of truth, Meili converges async.
    reconcileEveryMs: env.SEARCH_RECONCILE_EVERY_MS,
    reconcileStaleMs: env.SEARCH_RECONCILE_STALE_MS,
    reconcileMaxBackoffMs: env.SEARCH_RECONCILE_MAX_BACKOFF_MS,
    reconcileBatch: env.SEARCH_RECONCILE_BATCH,
    indexConcurrency: env.SEARCH_INDEX_CONCURRENCY,
    indexBatchSize: env.SEARCH_INDEX_BATCH_SIZE,
    maxIndexAttempts: env.SEARCH_MAX_INDEX_ATTEMPTS,
    purgeAfterDays: env.SEARCH_PURGE_AFTER_DAYS,
    purgeEveryMs: env.SEARCH_PURGE_EVERY_MS,
    purgeBatch: env.SEARCH_PURGE_BATCH,
    waitTimeoutMs: env.SEARCH_WAIT_TIMEOUT_MS,
    lagAlertSeconds: env.SEARCH_LAG_ALERT_SECONDS,
    registryTtlMs: env.SEARCH_REGISTRY_TTL_MS,
  };
});

export type SearchConfig = ReturnType<typeof searchConfig>;
