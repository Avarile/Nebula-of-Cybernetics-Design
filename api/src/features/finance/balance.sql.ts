import { sql, type SQL } from 'drizzle-orm';
import { transactions } from '../../infrastructure/database/schema/finance.schema';

/**
 * The ledger-derived balance for one account, as one query.
 *
 * This expression is the definition of "what the ledger says this account
 * holds", and it must mirror `LedgerService.applyEffects` exactly — income and
 * expense against `account_id`, and BOTH legs of a transfer. The difference
 * between this figure and `financial_accounts.current_balance` IS the drift
 * report, so an error here does not surface as a wrong number; it surfaces as
 * a clean bill of health over corrupted data, or as a "repair" that destroys
 * correct data.
 *
 * It lives here because it had two copies — one in `LedgerRepository`, one in
 * `scripts/reconcile-balances.ts` — that agreed only by inspection. The script
 * is the one tool in the codebase that overwrites financial figures from this
 * query, so the two drifting apart is the most expensive bug available in this
 * module. One definition, two callers.
 *
 * Excludes the opening balance: callers add it, because the script and the
 * repository read that column from different places.
 */
export function settledMovementsSql(accountId: string): SQL {
  return sql`
    SELECT COALESCE(SUM(
      CASE
        WHEN kind = 'income'  AND account_id = ${accountId} THEN amount
        WHEN kind = 'expense' AND account_id = ${accountId} THEN -amount
        -- Outgoing leg: the sending account is debited.
        WHEN kind = 'transfer' AND account_id = ${accountId}
             AND counter_account_id IS NOT NULL THEN -amount
        -- Incoming leg: the receiving account is credited.
        WHEN kind = 'transfer' AND counter_account_id = ${accountId} THEN amount
        ELSE 0
      END
    ), 0)::text AS balance
    FROM ${transactions}
    WHERE is_deleted = false
      AND status IN ('cleared', 'reconciled')
      AND (account_id = ${accountId} OR counter_account_id = ${accountId})
  `;
}
