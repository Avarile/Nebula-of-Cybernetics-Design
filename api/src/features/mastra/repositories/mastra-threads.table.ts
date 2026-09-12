import { pgSchema, text } from 'drizzle-orm/pg-core';
import { MASTRA_PG_SCHEMA } from '../mastra.constants';

/**
 * READ-ONLY Drizzle handle on Mastra's own thread table.
 *
 * `mastra.mastra_threads` is created and owned by `@mastra/pg` (see
 * `memory/memory.factory.ts`), not by us. This declaration exists purely so
 * `ConversationRepository.listByOwner` can join against the generated thread
 * title in a type-safe way.
 *
 * IMPORTANT: never export this from `infrastructure/database/schema/index.ts`.
 * `drizzle.config.ts` generates migrations from that barrel alone, and anything
 * reachable from it becomes drizzle-kit-managed — which would make drizzle-kit
 * try to create/alter/drop a table Mastra owns. Only the columns we actually
 * read are declared here, for the same reason.
 *
 * Note the id type: ours is `uuid`, Mastra's is `text`, so joins must cast.
 */
const mastraSchema = pgSchema(MASTRA_PG_SCHEMA);

export const mastraThreads = mastraSchema.table('mastra_threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
});
