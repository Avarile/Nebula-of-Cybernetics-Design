import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { validateEnv } from '../config/env.validation';
import * as schema from '../infrastructure/database/schema';
import { financialAccounts } from '../infrastructure/database/schema/finance.schema';
import { settledMovementsSql } from '../features/finance/balance.sql';
import { compare, sum } from '../features/finance/money.util';

/**
 * Balance drift report and repair (`pnpm reconcile:balances [--fix]`).
 *
 * `financial_accounts.current_balance` is a denormalized running total, kept up
 * to date by `LedgerService.applyEffects`. Anything that posts a settled
 * transaction without going through that method leaves the column behind, and
 * the gap never closes on its own — which is exactly what invoice payments did
 * until `InvoiceService` was moved onto `LedgerService.postSettled`.
 *
 * This walks every live account and compares the stored figure against the one
 * derived from the ledger. Read-only by default. `--fix` writes the derived
 * figure back, one account per statement, and prints what it changed.
 *
 * The derived sum must mirror `applyEffects` exactly — income and expense on
 * `account_id`, and BOTH legs of a transfer. An earlier version of this query
 * (in `LedgerRepository.reconcileBalance`) scored transfers as zero, so running
 * a repair against it would have erased every transfer from both accounts.
 * That is the failure mode this script has to be most careful about: it is the
 * one tool here that overwrites financial figures.
 */

interface Drift {
  id: string;
  name: string;
  currency: string;
  stored: string;
  derived: string;
}

/**
 * Ledger-derived balance for one account: opening + every settled movement.
 *
 * The query comes from `balance.sql.ts`, shared with
 * `LedgerRepository.reconcileBalance`. It used to be a second copy maintained
 * here by hand, which is the most dangerous duplication in the module: this is
 * the one tool that OVERWRITES balances from the result, so the two drifting
 * apart would not produce a wrong report, it would produce a confident repair
 * that destroys correct data.
 */
async function derivedBalance(
  db: ReturnType<typeof drizzle>,
  accountId: string,
  openingBalance: string,
): Promise<string> {
  const result = await db.execute<{ balance: string }>(
    settledMovementsSql(accountId),
  );
  return sum([openingBalance, result.rows[0]?.balance ?? '0']);
}

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
    // Verify the server certificate, per `DATABASE_SSL_REJECT_UNAUTHORIZED`.
    // `database.module.ts` explains why an unconditional `false` here is worse
    // than no TLS at all: encrypted but unauthenticated, so still MITM-able
    // while looking secure. (`seed.ts` still hardcodes the old form.)
    ssl: env.DATABASE_SSL
      ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED }
      : false,
  });
  const db = drizzle(pool, { schema });

  try {
    const accounts = await db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.isDeleted, false));

    const drifted: Drift[] = [];
    for (const account of accounts) {
      const derived = await derivedBalance(
        db,
        account.id,
        account.openingBalance,
      );
      if (compare(account.currentBalance, derived) !== 0) {
        drifted.push({
          id: account.id,
          name: account.name,
          currency: account.currency,
          stored: account.currentBalance,
          derived,
        });
      }
    }

    console.log(`Scanned ${accounts.length} live account(s).`);
    if (drifted.length === 0) {
      console.log('Every stored balance matches its ledger. Nothing to do.');
      return;
    }

    console.log(`\n${drifted.length} account(s) out of sync:\n`);
    for (const d of drifted) {
      const delta = sum([d.derived, `-${d.stored}`]);
      console.log(
        `  ${d.name}  (${d.id})\n` +
          `    stored  ${d.stored} ${d.currency}\n` +
          `    ledger  ${d.derived} ${d.currency}\n` +
          `    delta   ${delta.startsWith('-') ? delta : `+${delta}`} ${d.currency}`,
      );
    }

    if (!fix) {
      console.log(
        `\nRead-only. Re-run with --fix to write the ledger figure into ` +
          `current_balance for the ${drifted.length} account(s) above.`,
      );
      return;
    }

    console.log(`\nRepairing ${drifted.length} account(s)...`);
    let repaired = 0;
    for (const d of drifted) {
      // One statement per account, guarded on the value we actually read. If
      // anything moved the balance since the scan, the update matches nothing
      // and the account is reported rather than silently overwritten.
      const rows = await db
        .update(financialAccounts)
        .set({ currentBalance: d.derived })
        .where(
          and(
            eq(financialAccounts.id, d.id),
            eq(financialAccounts.currentBalance, d.stored),
          ),
        )
        .returning({ id: financialAccounts.id });
      if (rows.length === 0) {
        console.log(
          `  SKIPPED ${d.name} (${d.id}) — balance changed during the scan; re-run.`,
        );
        continue;
      }
      repaired += 1;
      console.log(`  ${d.name}: ${d.stored} -> ${d.derived} ${d.currency}`);
    }
    console.log(`\nRepaired ${repaired} of ${drifted.length} account(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Reconciliation failed:', error);
  process.exit(1);
});
