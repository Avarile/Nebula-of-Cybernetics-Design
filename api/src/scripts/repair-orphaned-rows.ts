import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { validateEnv } from '../config/env.validation';
import * as schema from '../infrastructure/database/schema';

/**
 * Orphan report and repair (`pnpm repair:orphans [--fix]`).
 *
 * `ProjectService.remove` used to soft-delete only the project row. Its tasks,
 * milestones, goals, links and time entries stayed `is_deleted = false` — and
 * because every task route authorizes through the parent project, a task under
 * a deleted project was simultaneously live and unreachable: it still appeared
 * in the unfiltered task list, but `GET`, `PATCH` and `DELETE` on it all 404'd.
 * No API route could retire it.
 *
 * `remove` now cascades in one transaction, so nothing new accumulates. This
 * clears what earlier deletes left behind. It also catches two smaller cases:
 * tasks pointing at a soft-deleted milestone (`removeMilestone` did not release
 * them until it was fixed), and search records for rows that are now gone.
 *
 * Read-only by default. `--fix` writes.
 *
 * Deliberately a bare Drizzle pool rather than a Nest application context —
 * the convention `reconcile-balances.ts` and `seed.ts` already follow. It does
 * not enqueue index jobs: marking a `search_records` row `is_deleted` with
 * `index_state = 'PENDING'` is enough, because the search reconciliation sweep
 * already picks up anything sitting outside `INDEXED` and propagates the
 * removal to Meilisearch. Reaching for BullMQ here would duplicate machinery
 * that already exists for exactly this.
 */

interface Finding {
  label: string;
  count: number;
  repair: string;
}

/** Every child table a project delete should have reached. */
const ORPHANED_UNDER_DEAD_PROJECT = [
  ['tasks', 'tasks'],
  ['milestones', 'milestones'],
  ['goals', 'goals'],
  ['project_members', 'project_members'],
  ['project_knowledge_links', 'project_knowledge_links'],
  ['project_contact_links', 'project_contact_links'],
] as const;

async function main(): Promise<void> {
  loadEnv();
  const fix = process.argv.includes('--fix');
  const env = validateEnv(process.env);
  const pool = new Pool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL
      ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED }
      : false,
  });
  const db = drizzle(pool, { schema });

  try {
    const findings: Finding[] = [];

    for (const [table] of ORPHANED_UNDER_DEAD_PROJECT) {
      const count = await scalar(
        db,
        `SELECT COUNT(*)::int AS n FROM ${table} t
           JOIN projects p ON p.id = t.project_id
          WHERE t.is_deleted = false AND p.is_deleted = true`,
      );
      findings.push({
        label: `${table} under a deleted project`,
        count,
        repair: `UPDATE ${table} t SET is_deleted = true, deleted_at = now()
                   FROM projects p
                  WHERE p.id = t.project_id
                    AND t.is_deleted = false AND p.is_deleted = true`,
      });
    }

    // Time entries are the one exception: an invoiced entry must stay live, or
    // an invoice line ends up billing hours that no longer exist.
    findings.push({
      label: 'time_entries under a deleted project (excluding invoiced)',
      count: await scalar(
        db,
        `SELECT COUNT(*)::int AS n FROM time_entries t
           JOIN projects p ON p.id = t.project_id
          WHERE t.is_deleted = false AND p.is_deleted = true
            AND t.invoice_line_item_id IS NULL`,
      ),
      repair: `UPDATE time_entries t SET is_deleted = true, deleted_at = now()
                 FROM projects p
                WHERE p.id = t.project_id
                  AND t.is_deleted = false AND p.is_deleted = true
                  AND t.invoice_line_item_id IS NULL`,
    });

    findings.push({
      label: 'tasks referencing a deleted milestone',
      count: await scalar(
        db,
        `SELECT COUNT(*)::int AS n FROM tasks t
           JOIN milestones m ON m.id = t.milestone_id
          WHERE t.is_deleted = false AND m.is_deleted = true`,
      ),
      repair: `UPDATE tasks t SET milestone_id = NULL, updated_at = t.updated_at
                 FROM milestones m
                WHERE m.id = t.milestone_id
                  AND t.is_deleted = false AND m.is_deleted = true`,
    });

    // Index records for rows that are gone. Marking them PENDING hands them to
    // the reconciliation sweep, which removes them from Meili.
    findings.push({
      label: 'search records for deleted tasks',
      count: await scalar(
        db,
        `SELECT COUNT(*)::int AS n FROM search_records r
           JOIN tasks t ON t.id::text = r.external_id
          WHERE r.collection = 'tasks' AND r.is_deleted = false
            AND t.is_deleted = true`,
      ),
      repair: `UPDATE search_records r
                  SET is_deleted = true, deleted_at = now(),
                      index_state = 'PENDING'
                 FROM tasks t
                WHERE t.id::text = r.external_id
                  AND r.collection = 'tasks' AND r.is_deleted = false
                  AND t.is_deleted = true`,
    });

    report(findings, fix);

    const total = findings.reduce((n, f) => n + f.count, 0);
    if (total === 0) {
      console.log('\nNothing to repair.');
      return;
    }
    if (!fix) {
      console.log('\nRe-run with --fix to repair.');
      return;
    }

    // One transaction: a half-applied repair leaves a different inconsistency
    // behind, which is worse than the one being fixed.
    //
    // Every pass runs, not just the ones that counted above zero, because the
    // passes feed each other: retiring a task turns its search record into an
    // orphan, and that record's count was taken before the task was deleted.
    // Each statement is idempotent and its own predicate decides whether there
    // is anything to do, so running them all in dependency order converges in
    // one pass rather than needing the operator to run the script twice.
    const repaired = await db.transaction(async (tx) => {
      let n = 0;
      for (const f of findings) {
        const result = await tx.execute(sql.raw(f.repair));
        n += result.rowCount ?? 0;
      }
      return n;
    });
    console.log(`\nRepaired ${repaired} row(s).`);
  } finally {
    await pool.end();
  }
}

function report(findings: Finding[], fix: boolean): void {
  console.log(
    `Orphan scan (${fix ? 'REPAIR' : 'read-only'})\n` + '─'.repeat(56),
  );
  for (const f of findings) {
    const mark = f.count === 0 ? '  ok ' : ' >>> ';
    console.log(`${mark}${String(f.count).padStart(6)}  ${f.label}`);
  }
}

async function scalar(
  db: ReturnType<typeof drizzle>,
  query: string,
): Promise<number> {
  const result = await db.execute(sql.raw(query));
  const rows = result.rows as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

main().catch((error) => {
  console.error('Orphan repair failed:', error);
  process.exit(1);
});
