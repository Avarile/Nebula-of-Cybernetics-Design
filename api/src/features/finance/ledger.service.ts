import { Inject, Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  FinancialAccountRow,
  NewTransactionRow,
  TransactionRow,
} from '../../infrastructure/database/schema/finance.schema';
import { ActivityService } from '../shared/activity.service';
import type {
  CreateAccountDto,
  CreateTransactionDto,
  ListTransactionsDto,
} from './dto/finance.dto';
import { FinanceRepository } from './finance.repository';
import { LedgerRepository, type TransactionQuery } from './ledger.repository';
import { compare, sum } from './money.util';

/** Statuses at which a transaction has moved money. */
const SETTLED: TransactionRow['status'][] = ['cleared', 'reconciled'];

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ledger: LedgerRepository,
    private readonly finance: FinanceRepository,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  // --- accounts ---

  listAccounts() {
    return this.finance.listAccounts();
  }

  async createAccount(dto: CreateAccountDto) {
    if (!(await this.finance.findCurrency(dto.currency))) {
      throw this.errors.validation([
        { path: 'currency', message: `Unknown currency "${dto.currency}"` },
      ]);
    }
    return this.finance.createAccount({
      ...dto,
      // An account starts at its opening balance; postings move it from there.
      currentBalance: dto.openingBalance,
    });
  }

  /** Compare the denormalized balance with the ledger it summarizes. */
  async reconcileAccount(id: string) {
    const account = await this.requireAccount(id);
    const derived = sum([
      account.openingBalance,
      await this.ledger.reconcileBalance(id),
    ]);
    return {
      accountId: id,
      storedBalance: account.currentBalance,
      derivedBalance: derived,
      inSync: compare(account.currentBalance, derived) === 0,
    };
  }

  // --- transactions ---

  async list(dto: ListTransactionsDto) {
    const query: TransactionQuery = dto;
    const { rows, total } = await this.ledger.list(query);
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async get(id: string): Promise<TransactionRow> {
    const row = await this.ledger.findById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  /**
   * Post a transaction.
   *
   * The row, the account balance and any matching budget move in ONE
   * transaction: a balance that reflects a posting which rolled back is worse
   * than a balance that is merely stale.
   */
  async create(
    dto: CreateTransactionDto,
    principal: Principal,
  ): Promise<TransactionRow> {
    await this.requireAccountFor(dto.accountId, dto.currency);
    // Both legs, not just the source. The counter-account was only checked for
    // existence, so 100.0000 AUD transferred into a USD account was credited
    // there as 100.0000 USD. A real cross-currency movement is two postings and
    // an FX rate, not one transfer, so there is nothing to convert here.
    if (dto.counterAccountId) {
      await this.requireAccountFor(dto.counterAccountId, dto.currency);
    }
    await this.requireCategoryFor(dto.categoryId, dto.kind);

    const row = await this.db.transaction((tx) =>
      this.postSettled({ ...dto, createdBy: userIdOrNull(principal) }, tx),
    );

    await this.activity.recordSafe({
      principal,
      entityType: 'transaction',
      entityId: row.id,
      projectId: row.projectId,
      action: `finance.${row.kind}_recorded`,
      summary: `${row.amount} ${row.currency} — ${row.description}`,
    });
    return row;
  }

  /**
   * Write a transaction AND apply the money it moves, on one executor.
   *
   * The single place that knows a settled transaction has to reach the account
   * balance and any budget it falls under. Every caller goes through it:
   * `create` and `reverse` open a transaction and hand it in, and
   * `InvoiceService.recordPayment` hands in its own.
   *
   * It exists because those two halves were separable and one caller separated
   * them. `InvoiceService` held a `LedgerRepository`, not this service, so
   * recording a payment inserted a `cleared` income row and never touched a
   * balance — `financial_accounts.current_balance` silently under-reported by
   * the sum of every invoice payment ever taken. Keeping the insert and the
   * effects in one method is what makes that unrepresentable rather than
   * merely discouraged.
   *
   * Callers MUST validate the account currency first (see `requireAccountFor`):
   * a posting in another unit corrupts the balance it lands in.
   */
  async postSettled(
    values: NewTransactionRow,
    executor: DrizzleExecutor,
  ): Promise<TransactionRow> {
    const created = await this.ledger.create(values, executor);
    if (SETTLED.includes(created.status)) {
      await this.applyEffects(created, 1, executor);
    }
    return created;
  }

  /**
   * Resolve the account a posting targets and refuse a currency mismatch.
   *
   * An account is single-currency by design, so a posting in another unit makes
   * its balance meaningless. Exposed because the invoice payment path needs the
   * same guarantee `create` has always had — it checked the payment against the
   * *invoice* currency and never against the account it was landing in.
   */
  async requireAccountFor(
    accountId: string,
    currency: string,
  ): Promise<FinancialAccountRow> {
    const account = await this.requireAccount(accountId);
    if (account.currency !== currency) {
      throw this.errors.validation([
        {
          path: 'currency',
          message: `Account "${account.name}" is in ${account.currency}`,
        },
      ]);
    }
    return account;
  }

  /**
   * Resolve a category and refuse one that points the other way.
   *
   * `financial_categories.kind` was stored and never consulted at write time,
   * so an expense could carry an income category and `spend-by-category`
   * reported it as spending — 44000.0000 under `client_revenue` in live data.
   */
  private async requireCategoryFor(
    categoryId: string | undefined,
    kind: TransactionRow['kind'],
  ): Promise<void> {
    if (!categoryId) return;
    const category = await this.finance.findCategory(categoryId);
    if (!category) {
      throw this.errors.validation([
        { path: 'categoryId', message: 'Unknown category' },
      ]);
    }
    if (category.kind !== kind) {
      throw this.errors.validation([
        {
          path: 'categoryId',
          message: `Category "${category.name}" is for ${category.kind}, not ${kind}`,
        },
      ]);
    }
  }

  /**
   * Change a transaction's status, applying the balance effects of the move.
   *
   * The only mutation a settled transaction accepts. Amounts are immutable once
   * cleared: a correction is a reversing entry, so history stays auditable.
   *
   * The row is read INSIDE the transaction under a row lock, and the update is
   * conditional on the status that read returned. Reading on the pool and
   * updating on `id` alone let concurrent callers each decide from the same
   * pre-transition snapshot: twelve simultaneous `pending -> cleared` requests
   * applied one 100.0000 posting eight times.
   */
  async setStatus(
    id: string,
    status: TransactionRow['status'],
    principal: Principal,
  ): Promise<TransactionRow> {
    const outcome = await this.db.transaction(async (tx) => {
      const existing = await this.ledger.findByIdForUpdate(id, tx);
      if (!existing) throw this.errors.create(ErrorCode.NOT_FOUND);
      if (existing.status === status) {
        return { row: existing, from: status, changed: false as const };
      }

      // `tx`, not the bare connection. The status change and the balance effects
      // it implies are one fact about the world: committing the first while
      // rolling back the second leaves a row marked settled whose money was
      // never applied.
      const updated = await this.ledger.updateStatusFrom(
        id,
        existing.status,
        status,
        tx,
      );
      if (!updated) {
        // The lock is held, so this is not a lost race — it is a row that was
        // deleted, or a status that moved between the lock and the write.
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: 'The transaction changed while this update was in flight',
        });
      }

      const wasSettled = SETTLED.includes(existing.status);
      const willSettle = SETTLED.includes(status);
      if (!wasSettled && willSettle) await this.applyEffects(updated, 1, tx);
      if (wasSettled && !willSettle) await this.applyEffects(updated, -1, tx);
      return { row: updated, from: existing.status, changed: true as const };
    });

    if (!outcome.changed) return outcome.row;

    await this.activity.recordSafe({
      principal,
      entityType: 'transaction',
      entityId: id,
      action: 'finance.transaction_status_changed',
      changes: { status: { from: outcome.from, to: status } },
    });
    return outcome.row;
  }

  /**
   * Reverse a settled transaction.
   *
   * A new, opposite entry rather than an edit or a delete. The original stays
   * exactly as it was recorded, which is what makes the ledger auditable —
   * and `reverses_transaction_id` ties the pair together.
   */
  async reverse(id: string, principal: Principal): Promise<TransactionRow> {
    const original = await this.get(id);
    if (!SETTLED.includes(original.status)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'Only a settled transaction needs reversing; void it instead',
      });
    }
    if (original.reversesTransactionId) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'A reversal cannot itself be reversed',
      });
    }

    const row = await this.db.transaction(async (tx) => {
      // Lock the original for the length of the reversal: two concurrent calls
      // both saw no contra entry and both wrote one. `reverses_transaction_id`
      // has no unique index, so the money moved twice.
      const locked = await this.ledger.findByIdForUpdate(id, tx);
      if (!locked) throw this.errors.create(ErrorCode.NOT_FOUND);
      const existing = await this.ledger.findReversalOf(id, tx);
      if (existing) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: `Already reversed by ${existing.description}`,
        });
      }

      return this.postSettled(
        {
          ...this.contraEntry(locked),
          occurredOn: new Date().toISOString().slice(0, 10),
          amount: locked.amount,
          currency: locked.currency,
          categoryId: locked.categoryId,
          projectId: locked.projectId,
          contactId: locked.contactId,
          companyId: locked.companyId,
          description: `Reversal of: ${locked.description}`,
          status: 'cleared',
          reversesTransactionId: locked.id,
          createdBy: userIdOrNull(principal),
        },
        tx,
      );
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'transaction',
      entityId: row.id,
      projectId: row.projectId,
      action: 'finance.transaction_reversed',
      summary: `Reversal of ${original.id}: ${original.amount} ${original.currency}`,
    });
    return row;
  }

  /**
   * The kind and accounts that undo a posting.
   *
   * Income and expense reverse by flipping the kind against the same account.
   * A transfer cannot: `applyEffects` always debits `accountId` and credits
   * `counterAccountId`, so a contra entry keeping both legs in place moved the
   * money the SAME way twice — reversing a 100.0000 transfer A -> B left A at
   * 800.0000 and B at 1200.0000. `reconcileBalance` derives by that same rule,
   * so both corrupted accounts still reported `inSync`, hiding it from the
   * integrity check and the repair script alike. Swapping the legs is the fix.
   */
  private contraEntry(original: TransactionRow): {
    kind: TransactionRow['kind'];
    accountId: string;
    counterAccountId: string | null;
  } {
    if (original.kind === 'transfer') {
      return {
        kind: 'transfer',
        accountId: original.counterAccountId ?? original.accountId,
        counterAccountId: original.counterAccountId ? original.accountId : null,
      };
    }
    return {
      kind: original.kind === 'income' ? 'expense' : 'income',
      accountId: original.accountId,
      counterAccountId: null,
    };
  }

  // --- reporting ---

  /**
   * Income and expense over a period, per currency.
   *
   * Income is reported alongside spending, from the same index, rather than
   * being derived by filtering an expense report.
   *
   * There is deliberately no top-level `income` / `expense` / `net` any more.
   * Those summed every currency together — 66100.0000 AUD and 600.0000 USD
   * published as an income of 66700.0000 — so they could not be made correct,
   * only withdrawn. A caller wanting one number picks a currency.
   */
  async summary(from: string, to: string, projectId?: string) {
    const totals = await this.ledger.totalsByKind(from, to, projectId);

    const byCurrency = [...new Set(totals.map((t) => t.currency))]
      .sort()
      .map((currency) => {
        const forCurrency = totals.filter((t) => t.currency === currency);
        const of = (kind: string) =>
          forCurrency.find((t) => t.kind === kind)?.total ?? '0';
        const income = of('income');
        const expense = of('expense');
        return {
          currency,
          income,
          expense,
          net: sum([income, `-${expense}`]),
        };
      });

    return { from, to, byCurrency, byKind: totals };
  }

  categoryBreakdown(
    from: string,
    to: string,
    kind: TransactionRow['kind'],
    projectId?: string,
  ) {
    return this.ledger.totalsByCategory(from, to, kind, projectId);
  }

  /**
   * Apply a posting's effects to the account balance and any matching budget.
   *
   * `sign` is 1 when settling and -1 when un-settling, so one code path handles
   * both directions and they cannot drift apart.
   */
  private async applyEffects(
    row: TransactionRow,
    sign: 1 | -1,
    tx: DrizzleExecutor,
  ): Promise<void> {
    const magnitude = row.amount;
    const signed =
      row.kind === 'income'
        ? magnitude
        : row.kind === 'expense'
          ? `-${magnitude}`
          : '0';

    if (row.kind === 'transfer' && row.counterAccountId) {
      await this.finance.adjustBalance(
        row.accountId,
        sign === 1 ? `-${magnitude}` : magnitude,
        tx,
      );
      await this.finance.adjustBalance(
        row.counterAccountId,
        sign === 1 ? magnitude : `-${magnitude}`,
        tx,
      );
    } else if (signed !== '0') {
      await this.finance.adjustBalance(
        row.accountId,
        sign === 1
          ? signed
          : signed.startsWith('-')
            ? signed.slice(1)
            : `-${signed}`,
        tx,
      );
    }

    // Only spending consumes a budget; income against a budget is not a thing.
    if (row.kind !== 'expense') return;
    const matching = await this.finance.budgetsMatching(
      {
        projectId: row.projectId,
        categoryId: row.categoryId,
        // A budget's `spent_amount` has no unit of its own; it inherits the
        // budget's. Matching without comparing currencies charged a 500.0000
        // USD expense against an AUD cap as 500.0000.
        currency: row.currency,
        occurredOn: row.occurredOn,
      },
      tx,
    );
    for (const budget of matching) {
      await this.finance.adjustBudgetSpend(
        budget.id,
        sign === 1 ? magnitude : `-${magnitude}`,
        tx,
      );
    }
  }

  private async requireAccount(id: string) {
    const account = await this.finance.findAccount(id);
    if (!account) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: 'Financial account not found',
      });
    }
    return account;
  }
}
