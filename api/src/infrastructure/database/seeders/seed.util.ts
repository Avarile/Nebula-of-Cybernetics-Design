import { eq, inArray, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DrizzleDB } from '../drizzle.constants';

/**
 * Insert only the rows whose business key is not already present.
 *
 * Seeders must be safe to re-run: `pnpm seed` executes on every fresh
 * environment and after most deploys. `ON CONFLICT` is awkward here because the
 * unique indexes in this schema are partial (`WHERE is_deleted = false`) and so
 * are not usable as a plain conflict target — read-then-insert states the intent
 * directly and costs one extra query per seeder.
 *
 * `keyOf` is explicit rather than derived from `keyColumn.name`: a Drizzle
 * column reports its SQL name (`entity_type`), which is not the property name on
 * the row object (`entityType`). Deriving one from the other silently matched
 * nothing for every column whose two names differ, so the seeder re-inserted
 * everything and tripped the unique index on its second run.
 *
 * Existing rows are never updated: a seeder that overwrites would silently undo
 * deliberate admin edits on every deploy.
 */
export async function insertMissingByKey<
  TTable extends PgTable,
  TRow extends Record<string, unknown>,
>(
  db: DrizzleDB,
  table: TTable,
  keyColumn: PgColumn,
  rows: TRow[],
  keyOf: (row: TRow) => string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const keys = rows.map(keyOf);
  const existing = await db
    .select({ key: keyColumn })
    .from(table as PgTable)
    .where(inArray(keyColumn, keys));
  const present = new Set(existing.map((r) => r.key as string));
  const missing = rows.filter((r) => !present.has(keyOf(r)));
  if (missing.length === 0) return 0;
  await db.insert(table).values(missing as never);
  return missing.length;
}

/** Resolve one row's id by its business key, or null when absent. */
export async function findIdByKey(
  db: DrizzleDB,
  table: PgTable,
  keyColumn: PgColumn,
  idColumn: PgColumn,
  key: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: idColumn })
    .from(table)
    .where(eq(keyColumn, key) as SQL)
    .limit(1);
  return (rows[0]?.id as string) ?? null;
}
