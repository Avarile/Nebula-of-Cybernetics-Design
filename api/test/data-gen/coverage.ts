import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';

/**
 * Table coverage report.
 *
 * The only file in this directory that touches the database, and it never
 * writes: generation goes through the API exclusively, but proving that every
 * table ended up with rows cannot itself be done through the API — there is no
 * endpoint that reports "is `contact_tags` populated?", and inferring it from
 * successful POSTs would be assuming the answer.
 *
 * A table is only allowed to be empty if it appears in BLOCKED with a reason.
 * Anything else empty fails the report, so a silently unreachable table shows
 * up as a failure rather than as a number nobody reads.
 */

/** Tables that cannot be filled through the API, and precisely why. */
const BLOCKED: Record<string, string> = {
  notifications:
    'No API creates one. NotificationService.enqueue is implemented but has no caller ' +
    'outside its own module (design §14 item 1) — emission wiring was deliberately ' +
    'deferred, so there is no endpoint and no domain event that produces a row.',
  notification_delivery_attempts:
    'Written only by the drain processor when it attempts delivery of a notification. ' +
    'Empty as a direct consequence of `notifications` being empty.',
  agent_action_log:
    'Written when the agent invokes a tool. Requires a reachable AI gateway; ' +
    'POST /agent/chat currently returns 500, and the API suite already soft-fails it.',
  agent_approval:
    'Written when an agent tool call needs human approval. Same dependency as ' +
    'agent_action_log — no agent run, no approval to record.',
  email_messages:
    'Populated by POST /mailbox/sync against a live IMAP host holding real messages. ' +
    'No such host is configured for this environment.',
  email_attachments:
    'Requires an ingested email that carries an attachment. Same dependency as ' +
    'email_messages.',
};

/** Tables that are infrastructure rather than application data. */
const IGNORED = new Set(['__drizzle_migrations', 'drizzle_migrations']);

async function main(): Promise<void> {
  loadEnv({ path: resolve(__dirname, '../../.env'), quiet: true } as never);
  const e = process.env;

  const pool = new Pool({
    host: e.DATABASE_HOST,
    port: Number(e.DATABASE_PORT ?? 5432),
    user: e.DATABASE_USER,
    password: e.DATABASE_PASSWORD,
    database: e.DATABASE_NAME,
    ssl:
      String(e.DATABASE_SSL).toLowerCase() === 'true'
        ? {
            rejectUnauthorized:
              String(e.DATABASE_SSL_REJECT_UNAUTHORIZED).toLowerCase() !==
              'false',
          }
        : false,
  });

  try {
    const { rows: tableRows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    const tables = tableRows
      .map((r) => r.table_name)
      .filter((t) => !IGNORED.has(t));

    const counts: Array<{ table: string; rows: number }> = [];
    for (const table of tables) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${table}"`,
      );
      counts.push({ table, rows: Number(rows[0].n) });
    }

    const populated = counts.filter((c) => c.rows > 0);
    const empty = counts.filter((c) => c.rows === 0);
    const explained = empty.filter((c) => BLOCKED[c.table]);
    const unexplained = empty.filter((c) => !BLOCKED[c.table]);

    const width = Math.max(...counts.map((c) => c.table.length));
    console.log('='.repeat(78));
    console.log('TABLE COVERAGE');
    console.log('='.repeat(78));
    for (const c of counts) {
      const mark = c.rows > 0 ? '✔' : BLOCKED[c.table] ? '–' : '✗';
      console.log(
        `  ${mark} ${c.table.padEnd(width)}  ${String(c.rows).padStart(7)}`,
      );
    }

    console.log('\n' + '-'.repeat(78));
    console.log(
      `  ${populated.length}/${counts.length} tables populated` +
        `  |  ${explained.length} blocked (explained)` +
        `  |  ${unexplained.length} unexplained`,
    );
    console.log('-'.repeat(78));

    if (explained.length > 0) {
      console.log(
        '\nEmpty by known limitation — not reachable through the API:',
      );
      for (const c of explained) {
        console.log(`\n  ${c.table}`);
        for (const line of wrap(BLOCKED[c.table], 72))
          console.log(`      ${line}`);
      }
    }

    if (unexplained.length > 0) {
      console.log('\n✗ EMPTY WITH NO RECORDED REASON:');
      for (const c of unexplained) console.log(`    ${c.table}`);
      console.log(
        '\n  Either the generator does not cover these yet, or they need an ' +
          'entry in BLOCKED explaining why they cannot be covered.',
      );
    }

    writeFileSync(
      resolve(__dirname, 'last-coverage.json'),
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          database: e.DATABASE_NAME,
          total: counts.length,
          populated: populated.length,
          blocked: explained.map((c) => ({
            table: c.table,
            reason: BLOCKED[c.table],
          })),
          unexplained: unexplained.map((c) => c.table),
          counts,
        },
        null,
        2,
      ),
    );

    process.exit(unexplained.length > 0 ? 1 : 0);
  } finally {
    await pool.end();
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += ' ' + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
