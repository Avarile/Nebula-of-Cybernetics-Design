import { Logger } from '@nestjs/common';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

const logger = new Logger('SchemaVersion');

/** Drizzle records applied migrations here. */
const JOURNAL_TABLE = 'drizzle.__drizzle_migrations';

/**
 * Refuse to serve traffic against an un-migrated database.
 *
 * Nothing ran or verified migrations: `db:migrate` is a CLI step with no
 * enforcement, so a replica booting against an old schema started happily and
 * then failed at the first query with a raw Postgres error — one confusing
 * symptom per endpoint instead of one clear failure at startup.
 *
 * This checks the count of applied migrations against the number of `.sql` files
 * on disk. It deliberately does NOT apply them: running migrations from every
 * booting replica races, and schema changes should be a deliberate deploy step.
 */
export async function assertSchemaIsCurrent(
  pool: Pool,
  migrationsDir: string,
): Promise<void> {
  const onDisk = readdirSync(migrationsDir).filter((f) =>
    f.endsWith('.sql'),
  ).length;

  let applied: number;
  try {
    const result = await pool.query<{ count: string }>(
      `select count(*)::text as count from ${JOURNAL_TABLE}`,
    );
    applied = Number(result.rows[0]?.count ?? 0);
  } catch {
    throw new Error(
      `Database has no migration journal (${JOURNAL_TABLE}). ` +
        `Run "pnpm db:migrate" before starting the application.`,
    );
  }

  if (applied < onDisk) {
    throw new Error(
      `Database schema is behind: ${applied} migration(s) applied, ${onDisk} on disk. ` +
        `Run "pnpm db:migrate" before starting the application.`,
    );
  }
  if (applied > onDisk) {
    // The database is ahead — a rollback, or a replica of an older build. Not
    // fatal (the newer schema is usually a superset) but never silent.
    logger.warn(
      `Database reports ${applied} applied migration(s) but this build ships ` +
        `${onDisk}. This deployment may be older than the schema it is using.`,
    );
    return;
  }
  logger.log(`Database schema is current (${applied} migrations applied)`);
}

/** Migrations live beside the compiled output as well as the source tree. */
export function migrationsDir(): string {
  return join(__dirname, 'migrations');
}
