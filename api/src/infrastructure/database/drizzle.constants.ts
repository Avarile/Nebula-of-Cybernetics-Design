import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

/** DI token for the underlying pg connection pool. */
export const PG_POOL = Symbol('PG_POOL');

/** DI token for the Drizzle database instance. */
export const DRIZZLE = Symbol('DRIZZLE');

/** Strongly-typed Drizzle database, aware of the full schema. */
export type DrizzleDB = NodePgDatabase<typeof schema>;

/**
 * Anything that can run a query: the pool, or a transaction handle.
 *
 * Repositories that must be callable from inside a caller's transaction accept
 * this instead of `DrizzleDB`. Without it, a service could only write through
 * its own connection, so an activity row or an outbox row could not join the
 * transaction of the change it describes — which is the whole point of both.
 */
export type DrizzleExecutor =
  DrizzleDB | Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
