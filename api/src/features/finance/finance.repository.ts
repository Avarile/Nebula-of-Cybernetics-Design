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
  budgets,
  currencies,
  financialAccounts,
  financialCategories,
  fxRates,
  type BudgetRow,
  type CurrencyRow,
  type FinancialAccountRow,
  type FinancialCategoryRow,
  type FxRateRow,
  type NewBudgetRow,
  type NewFinancialAccountRow,
  type NewFinancialCategoryRow,
} from '../../infrastructure/database/schema/finance.schema';

/** Accounts, categories, budgets and the currency reference table. */
@Injectable()
export class FinanceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listCurrencies(): Promise<CurrencyRow[]> {
    return this.db
      .select()
      .from(currencies)
      .where(eq(currencies.isActive, true))
      .orderBy(asc(currencies.code));
  }

  async findCurrency(code: string): Promise<CurrencyRow | null> {
    const rows = await this.db
      .select()
      .from(currencies)
      .where(eq(currencies.code, code.toUpperCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  // --- accounts ---

  listAccounts(): Promise<FinancialAccountRow[]> {
    return this.db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.isDeleted, false))
      .orderBy(asc(financialAccounts.name));
  }

  async findAccount(id: string): Promise<FinancialAccountRow | null> {
    const rows = await this.db
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, id),
          eq(financialAccounts.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createAccount(
    values: NewFinancialAccountRow,
  ): Promise<FinancialAccountRow> {
    const rows = await this.db
      .insert(financialAccounts)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateAccount(
    id: string,
    patch: Partial<NewFinancialAccountRow>,
  ): Promise<FinancialAccountRow | null> {
    const rows = await this.db
      .update(financialAccounts)
      .set(patch)
      .where(
        and(
          eq(financialAccounts.id, id),
          eq(financialAccounts.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Apply a signed delta to an account balance.
   *
   * Relative SQL, not read-modify-write: two postings landing at once must not
   * lose one another's effect. The denormalized balance is reconcilable by
   * summing transactions, but it should not drift under ordinary load.
   */
  async adjustBalance(
    id: string,
    delta: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(financialAccounts)
      .set({
        currentBalance: sql`${financialAccounts.currentBalance} + ${delta}::numeric`,
      })
      .where(eq(financialAccounts.id, id));
  }

  // --- categories ---

  listCategories(kind?: FinancialCategoryRow['kind']) {
    return this.db
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.isDeleted, false),
          kind ? eq(financialCategories.kind, kind) : undefined,
        ),
      )
      .orderBy(asc(financialCategories.path));
  }

  async findCategory(id: string): Promise<FinancialCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.id, id),
          eq(financialCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCategoryByKey(key: string): Promise<FinancialCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.key, key),
          eq(financialCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createCategory(
    values: NewFinancialCategoryRow,
  ): Promise<FinancialCategoryRow> {
    const rows = await this.db
      .insert(financialCategories)
      .values(values)
      .returning();
    return rows[0];
  }

  // --- budgets ---

  async listBudgets(q: {
    projectId?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: BudgetRow[]; total: number }> {
    const filters: SQL[] = [eq(budgets.isDeleted, false)];
    if (q.projectId) filters.push(eq(budgets.projectId, q.projectId));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(budgets)
      .where(where)
      .orderBy(desc(budgets.periodStart))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(budgets)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async findBudget(id: string): Promise<BudgetRow | null> {
    const rows = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createBudget(values: NewBudgetRow): Promise<BudgetRow> {
    const rows = await this.db.insert(budgets).values(values).returning();
    return rows[0];
  }

  async updateBudget(
    id: string,
    patch: Partial<NewBudgetRow>,
  ): Promise<BudgetRow | null> {
    const rows = await this.db
      .update(budgets)
      .set(patch)
      .where(and(eq(budgets.id, id), eq(budgets.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteBudget(id: string): Promise<void> {
    await this.db
      .update(budgets)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(budgets.id, id));
  }

  /**
   * Budgets a posting falls under — same project, category, period AND currency.
   *
   * Used to keep `spent_amount` current. A transaction can match more than one
   * budget (a project budget and a category budget), and both should move.
   *
   * Takes an executor so the read runs inside the same transaction as the spend
   * adjustment it feeds — reading on the pool while writing in a transaction
   * meant this saw a different snapshot than the `adjustBudgetSpend` calls it
   * decides.
   *
   * The currency predicate is not optional tidiness. Without it a 500.0000 USD
   * expense was added to an AUD budget as 500.0000, because `spent_amount` has
   * no unit of its own — it inherits the budget's, and the posting's was never
   * compared against it.
   *
   * `exceeded` is matched alongside `active`: a budget that has passed its cap
   * must keep accruing, or the first overspend freezes the figure the alert is
   * computed from.
   */
  async budgetsMatching(
    input: {
      projectId: string | null;
      categoryId: string | null;
      currency: string;
      occurredOn: string;
    },
    executor: DrizzleExecutor = this.db,
  ): Promise<BudgetRow[]> {
    return executor
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.isDeleted, false),
          sql`${budgets.status} IN ('active', 'exceeded')`,
          eq(budgets.currency, input.currency),
          lte(budgets.periodStart, input.occurredOn),
          gte(budgets.periodEnd, input.occurredOn),
          input.projectId
            ? sql`(${budgets.projectId} IS NULL OR ${budgets.projectId} = ${input.projectId})`
            : sql`${budgets.projectId} IS NULL`,
          input.categoryId
            ? sql`(${budgets.categoryId} IS NULL OR ${budgets.categoryId} = ${input.categoryId})`
            : sql`${budgets.categoryId} IS NULL`,
        ),
      );
  }

  /**
   * Move a budget's consumed total, and its status with it.
   *
   * Status is derived in the same statement as the amount rather than in a
   * follow-up write: `budget_status` has had an `exceeded` member since the
   * first migration and nothing ever wrote it, so a budget sat at 140% of its
   * cap still reporting `active`. Computing it from `spent_amount + delta`
   * means the two can never disagree, and a concurrent posting cannot land
   * between the amount and the status.
   *
   * Only `active` and `exceeded` are re-derived — a `draft` or `closed` budget
   * keeps whatever an operator set.
   */
  async adjustBudgetSpend(
    id: string,
    delta: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(budgets)
      .set({
        spentAmount: sql`${budgets.spentAmount} + ${delta}::numeric`,
        // Cast explicitly rather than relying on the first branch's column
        // reference to anchor the type — see the same CASE in
        // `InvoiceRepository.applyPayment`, where there is no column branch and
        // the untyped literals were rejected outright.
        status: sql`
          CASE
            WHEN ${budgets.status} NOT IN ('active', 'exceeded') THEN ${budgets.status}
            WHEN ${budgets.spentAmount} + ${delta}::numeric > ${budgets.amount} THEN 'exceeded'
            ELSE 'active'
          END::budget_status
        `,
      })
      .where(eq(budgets.id, id));
  }

  /**
   * Spend already on the ledger for a budget's scope, at the moment it is made.
   *
   * `adjustBudgetSpend` only ever accrues forward from a posting, so a budget
   * created after the money was spent started at 0.0000 and stayed wrong for
   * its whole period — 7 of 36 budgets in the live dataset disagreed with the
   * ledger this way, several reading zero against thousands of real spend.
   * Seeding from the ledger makes the column mean the same thing regardless of
   * when the budget was created.
   *
   * The predicates mirror `budgetsMatching` exactly, in the opposite direction:
   * there, a posting finds its budgets; here, a budget finds its postings.
   */
  async spendForScope(input: {
    projectId: string | null;
    categoryId: string | null;
    currency: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<string> {
    const result = await this.db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS total
      FROM transactions
      WHERE is_deleted = false
        AND kind = 'expense'
        AND status IN ('cleared', 'reconciled')
        AND currency = ${input.currency}
        AND occurred_on BETWEEN ${input.periodStart} AND ${input.periodEnd}
        AND ${
          input.projectId
            ? sql`project_id = ${input.projectId}`
            : sql`TRUE /* a budget with no project matches every project */`
        }
        AND ${
          input.categoryId
            ? sql`category_id = ${input.categoryId}`
            : sql`TRUE /* a budget with no category matches every category */`
        }
    `);
    return result.rows[0]?.total ?? '0';
  }

  /**
   * Budgets at or past their alert threshold, decided in SQL.
   *
   * This was a `Number(spentAmount) / Number(amount)` comparison over the first
   * 500 budgets, which violated the module's no-floats policy, silently dropped
   * budget 501, and evaluated closed budgets alongside live ones. Postgres
   * compares the numerics exactly and applies the threshold as the predicate,
   * so there is no page to fall off the end of.
   */
  async budgetsAtRisk(): Promise<BudgetRow[]> {
    return this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.isDeleted, false),
          sql`${budgets.status} IN ('active', 'exceeded')`,
          sql`${budgets.amount} > 0`,
          sql`${budgets.spentAmount} * 100 >= ${budgets.amount} * ${budgets.alertThresholdPct}`,
        ),
      )
      .orderBy(desc(budgets.periodStart));
  }

  /**
   * The rate archive, most recent first. Bounded because this is reference
   * data an operator scrolls, not a series a report streams.
   */
  listFxRates(
    filter: { baseCode?: string; quoteCode?: string } = {},
  ): Promise<FxRateRow[]> {
    const clauses: SQL[] = [];
    if (filter.baseCode)
      clauses.push(eq(fxRates.baseCode, filter.baseCode.toUpperCase()));
    if (filter.quoteCode)
      clauses.push(eq(fxRates.quoteCode, filter.quoteCode.toUpperCase()));
    return this.db
      .select()
      .from(fxRates)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(fxRates.asOf), asc(fxRates.baseCode))
      .limit(500);
  }

  /**
   * Record a rate, correcting the same pair+date in place.
   *
   * `onConflictDoUpdate` against the unique index rather than a read-then-write:
   * two importers running the same feed concurrently would otherwise race
   * between the SELECT and the INSERT and one would fail on the constraint.
   */
  async upsertFxRate(row: {
    baseCode: string;
    quoteCode: string;
    rate: string;
    asOf: string;
    source?: string;
  }): Promise<FxRateRow> {
    const values = {
      baseCode: row.baseCode.toUpperCase(),
      quoteCode: row.quoteCode.toUpperCase(),
      rate: row.rate,
      asOf: row.asOf,
      source: row.source ?? null,
    };
    const inserted = await this.db
      .insert(fxRates)
      .values(values)
      .onConflictDoUpdate({
        target: [fxRates.baseCode, fxRates.quoteCode, fxRates.asOf],
        set: { rate: values.rate, source: values.source },
      })
      .returning();
    return inserted[0];
  }
}
