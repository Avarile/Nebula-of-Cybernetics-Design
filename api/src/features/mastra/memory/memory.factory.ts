import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { MASTRA_PG_SCHEMA } from '../mastra.constants';

/**
 * Shared Postgres-backed store over the app pool, scoped to the `mastra` schema.
 *
 * Deviation from the brief: the installed `@mastra/pg@1.15.1` exports the class as
 * `PostgresStore`, not `PgStore` (there is no `PgStore` export in this package version).
 * The constructor option shape the brief assumed (`{ id, pool, schemaName }`) is otherwise
 * unchanged — `PostgresStoreConfig`'s pool variant (`PoolInstanceConfig`) is
 * `PostgresBaseConfig & { pool: Pool }` where `PostgresBaseConfig` has `id: string` and
 * `schemaName?: string`.
 */
export function buildStore(pool: Pool): PostgresStore {
  return new PostgresStore({
    id: 'mastra-pg',
    pool,
    schemaName: MASTRA_PG_SCHEMA,
  });
}

/**
 * Conversation persistence is owned entirely by Mastra (threads, messages, working
 * memory, workflow snapshots) in the `mastra` Postgres schema on the SAME pool.
 * v1: recent-message window + resource-scoped working memory; semantic recall OFF.
 *
 * Confirmed installed `@mastra/memory@1.23.0` `Memory` constructor option shape
 * (`MemoryConstructorConfig` in `@mastra/core/memory`'s `SharedMemoryConfig`/
 * `MemoryConfigInternal`) matches the brief 1:1: `{ storage, options: { lastMessages,
 * semanticRecall, workingMemory: { enabled, scope, template }, generateTitle } }`.
 * `storage` accepts any `MastraCompositeStore`, which `PostgresStore` extends.
 */
export function buildMemory(pool: Pool, cfg: MastraConfig): Memory {
  return new Memory({
    storage: buildStore(pool),
    options: {
      lastMessages: cfg.memoryLastMessages,
      semanticRecall: false,
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: '# User\n- Name:\n- Role:\n- Preferences:\n- Ongoing goals:',
      },
      generateTitle: true,
    },
  });
}
