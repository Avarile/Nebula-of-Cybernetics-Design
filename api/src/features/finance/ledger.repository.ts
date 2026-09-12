import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  recurringTransactions,
  transactions,
  type NewRecurringTransactionRow,
  type NewTransactionRow,
  type RecurringTransactionRow,
  type TransactionRow,
} from '../../infrastructure/database/schema/finance.schema';
import { settledMovementsSql } from './balance.sql';

export interface TransactionQuery {
  kind?: TransactionRow['kind'];
  status?: TransactionRow['status'];
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  contactId?: string;
  companyId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

@Injectable()
export class LedgerRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findById(
    id: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<TransactionRow | null> {
    const rows = await executor
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Read a transaction and hold a row lock on it until the caller commits.
   *
   * `setStatus` used to read the row on the pool and then update it inside a
   * transaction keyed on `id` alone. Concurrent callers therefore all saw the
   * same pre-transition status, all concluded the row was not yet settled, and
   * all applied the balance effect — twelve simultaneous `pending -> cleared`
   * calls moved a single 100.0000 posting eight times. `FOR UPDATE` makes the
   * read-decide-write sequence serial, which is what it always assumed it was.
   */
  async findByIdForUpdate(
    id: string,
    executor: DrizzleExecutor,
  ): Promise<TransactionRow | null> {
    const rows = await executor
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  /**
   * The contra entry pointing at a transaction, if one exists.
   *
   * `reverse` refuses to reverse a reversal, but nothing stopped the SAME
   * transaction being reversed twice — `reverses_transaction_id` carries no
   * unique index, so two contra entries against one original were accepted and
   * the balance moved twice.
   */
  async findReversalOf(
    id: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<TransactionRow | null> {
    const rows = await executor
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.reversesTransactionId, id),
          eq(transactions.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    q: TransactionQuery,
  ): Promise<{ rows: TransactionRow[]; total: number }> {
    const filters: SQL[] = [eq(transactions.isDeleted, false)];
    if (q.kind) filters.push(eq(transactions.kind, q.kind));
    if (q.status) filters.push(eq(transactions.status, q.status));
    if (q.accountId) filters.push(eq(transactions.accountId, q.accountId));
    if (q.categoryId) filters.push(eq(transactions.categoryId, q.categoryId));
    if (q.projectId) filters.push(eq(transactions.projectId, q.projectId));
    if (q.contactId) filters.push(eq(transactions.contactId, q.contactId));
    if (q.companyId) filters.push(eq(transactions.companyId, q.companyId));
    if (q.from) filters.push(gte(transactions.occurredOn, q.from));
    if (q.to) filters.push(lte(transactions.occurredOn, q.to));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(transactions)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async create(
    values: NewTransactionRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<TransactionRow> {
    const rows = await executor.insert(transactions).values(values).returning();
    return rows[0];
  }

  /**
   * Patch a transaction, optionally on a caller-supplied executor.
   *
   * `executor` is not optional decoration. `LedgerService.setStatus` changes a
   * status and applies the matching balance effects, and those two halves have
   * to commit together. Without this parameter the status write went out on the
   * pool and auto-committed while the effects were still staged in the caller's
   * transaction — so a failure in `applyEffects` rolled back the money and left
   * the row claiming to be settled. Mirrors `create` and `InvoiceRepository.update`.
   */
  async update(
    id: string,
    patch: Partial<NewTransactionRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<TransactionRow | null> {
    const rows = await executor
      .update(transactions)
      .set(patch)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Move a transaction between statuses, refusing if it is no longer in the one
   * the caller decided from.
   *
   * The compare-and-swap half of the fix `findByIdForUpdate` starts: the row
   * lock serializes the callers, and this predicate means a caller that was
   * queued behind another cannot apply a transition that has already happened.
   * Returns null when the row moved underneath it, which the caller reports as
   * a conflict rather than silently double-applying the balance effect.
   */
  async updateStatusFrom(
    id: string,
    expected: TransactionRow['status'],
    status: TransactionRow['status'],
    executor: DrizzleExecutor,
  ): Promise<TransactionRow | null> {
    const rows = await executor
      .update(transactions)
      .set({ status })
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.isDeleted, false),
          eq(transactions.status, expected),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(transactions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(transactions.id, id));
  }

  /**
   * Income and expense totals over a period, grouped by kind AND currency.
   *
   * Reads `transactions_kind_date_idx`. Income reporting is a first-class query
   * here, not a filter applied to an expense report in memory.
   *
   * `currency` is in the GROUP BY because it was not, and the report added
   * every unit together: 66100.0000 AUD plus 600.0000 USD was published as an
   * income of 66700.0000 with no unit named, and the net was arithmetic across
   * two currencies. Every amount-bearing row carries its own currency precisely
   * so this cannot be papered over — an aggregate that spans units is not a
   * number, and the query must not be able to produce one.
   */
  async totalsByKind(
    from: string,
    to: string,
    projectId?: string,
  ): Promise<
    Array<{
      kind: string;
      currency: string;
      total: string;
      count: number;
    }>
  > {
    const result = await this.db.execute<{
      kind: string;
      currency: string;
      total: string;
      count: string;
    }>(sql`
      SELECT kind, currency,
             COALESCE(SUM(amount), 0)::text AS total,
             COUNT(*)::text AS count
      FROM ${transactions}
      WHERE is_deleted = false
        AND status IN ('cleared', 'reconciled')
        AND occurred_on BETWEEN ${from} AND ${to}
        ${projectId ? sql`AND project_id = ${projectId}` : sql``}
      GROUP BY kind, currency
      ORDER BY currency ASC, kind ASC
    `);
    return result.rows.map((r) => ({
      kind: r.kind,
      currency: r.currency,
      total: r.total,
      count: Number(r.count),
    }));
  }

  /**
   * Totals per category, for a spend or revenue breakdown.
   *
   * Grouped by currency for the same reason as `totalsByKind`, and scoped by
   * `projectId` so the category reports honour the filter their route accepts.
   */
  async totalsByCategory(
    from: string,
    to: string,
    kind: TransactionRow['kind'],
    projectId?: string,
  ): Promise<
    Array<{ categoryId: string | null; currency: string; total: string }>
  > {
    const result = await this.db.execute<{
      category_id: string | null;
      currency: string;
      total: string;
    }>(sql`
      SELECT category_id, currency, COALESCE(SUM(amount), 0)::text AS total
      FROM ${transactions}
      WHERE is_deleted = false
        AND status IN ('cleared', 'reconciled')
        AND kind = ${kind}
        AND occurred_on BETWEEN ${from} AND ${to}
        ${projectId ? sql`AND project_id = ${projectId}` : sql``}
      GROUP BY category_id, currency
      ORDER BY 3 DESC
    `);
    return result.rows.map((r) => ({
      categoryId: r.category_id,
      currency: r.currency,
      total: r.total,
    }));
  }

  /**
   * Sum of an account's cleared movements — the balance reconciliation.
   *
   * The query itself lives in `balance.sql.ts`, shared with the repair script
   * that overwrites balances from it. It must mirror `LedgerService.applyEffects`
   * exactly, because the difference between the two IS the drift report.
   */
  async reconcileBalance(accountId: string): Promise<string> {
    const result = await this.db.execute<{ balance: string }>(
      settledMovementsSql(accountId),
    );
    return result.rows[0]?.balance ?? '0';
  }

  // --- recurring ---

  listRecurring(activeOnly = true): Promise<RecurringTransactionRow[]> {
    return this.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.isDeleted, false),
          activeOnly ? eq(recurringTransactions.isActive, true) : undefined,
        ),
      )
      .orderBy(asc(recurringTransactions.nextDueOn));
  }

  async findRecurring(id: string): Promise<RecurringTransactionRow | null> {
    const rows = await this.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Schedules whose next occurrence has arrived.
   *
   * Hits `recurring_transactions_due_idx`, partial on active, live rows.
   */
  dueRecurring(onOrBefore: string): Promise<RecurringTransactionRow[]> {
    return this.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.isDeleted, false),
          eq(recurringTransactions.isActive, true),
          lte(recurringTransactions.nextDueOn, onOrBefore),
        ),
      );
  }

  async createRecurring(
    values: NewRecurringTransactionRow,
  ): Promise<RecurringTransactionRow> {
    const rows = await this.db
      .insert(recurringTransactions)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateRecurring(
    id: string,
    patch: Partial<NewRecurringTransactionRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<RecurringTransactionRow | null> {
    const rows = await executor
      .update(recurringTransactions)
      .set(patch)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Claim one occurrence of a schedule by advancing its cursor, but only if
   * nobody has advanced it already.
   *
   * The sweep used to generate a transaction and then advance the cursor as two
   * separate statements with no transaction around them: a crash in between left
   * `lastGeneratedOn` behind `nextDueOn`, so the next sweep re-posted the same
   * occurrence, and two concurrent sweeps both read the same due row and both
   * posted it. Advancing first, guarded on the value the caller decided from,
   * makes the occurrence a thing exactly one sweep can take — and because the
   * posting shares the transaction, a failure there releases the claim.
   */
  async claimOccurrence(
    id: string,
    expectedNextDueOn: string,
    advanceTo: { lastGeneratedOn: string; nextDueOn: string },
    executor: DrizzleExecutor,
  ): Promise<RecurringTransactionRow | null> {
    const rows = await executor
      .update(recurringTransactions)
      .set(advanceTo)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.isDeleted, false),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.nextDueOn, expectedNextDueOn),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteRecurring(id: string): Promise<void> {
    await this.db
      .update(recurringTransactions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(recurringTransactions.id, id));
  }
}
