import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/principal';
import { ExceptionService } from '../../infrastructure/exceptions';
import { ActivityService } from '../shared/activity.service';
import type { CreateBudgetDto } from './dto/finance.dto';
import { FinanceRepository } from './finance.repository';
import { compare, percentageOf } from './money.util';

/**
 * Budget caps and their alerting.
 *
 * Split out of `LedgerService`, which had grown to cover accounts, the ledger,
 * budgets and reporting at once. Budget consumption is still driven from
 * `LedgerService.applyEffects` — a posting is what moves `spent_amount`, and
 * that has to stay inside the posting's own transaction — so this service owns
 * the budget lifecycle, not the accrual.
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly finance: FinanceRepository,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  list(projectId: string | undefined, page: number, limit: number) {
    return this.finance.listBudgets({ projectId, page, limit });
  }

  /**
   * Create a budget, seeded with the spend its period has already seen.
   *
   * `spent_amount` only ever accrues forward from a posting, so a budget made
   * after the money went out began at 0.0000 and stayed wrong for its whole
   * period — 7 of 36 live budgets, some reading zero against thousands of real
   * spend. Seeding from the ledger makes the column mean "spend in this scope"
   * rather than "spend since someone created this row".
   */
  async create(dto: CreateBudgetDto, principal: Principal) {
    if (dto.periodEnd < dto.periodStart) {
      throw this.errors.validation([
        { path: 'periodEnd', message: 'The period ends before it starts' },
      ]);
    }
    if (!(await this.finance.findCurrency(dto.currency))) {
      throw this.errors.validation([
        { path: 'currency', message: `Unknown currency "${dto.currency}"` },
      ]);
    }

    const spentAmount = await this.finance.spendForScope({
      projectId: dto.projectId ?? null,
      categoryId: dto.categoryId ?? null,
      currency: dto.currency,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
    });
    const row = await this.finance.createBudget({
      ...dto,
      spentAmount,
      status: compare(spentAmount, dto.amount) > 0 ? 'exceeded' : 'active',
    });

    // `activity_entity_type` has no `budget` member, and claiming `transaction`
    // for a budget id pointed the audit trail at a row that does not exist.
    // `system` is the honest bucket until the enum gains one.
    await this.activity.recordSafe({
      principal,
      entityType: 'system',
      entityId: row.id,
      projectId: row.projectId,
      action: 'finance.budget_created',
      summary: `${row.name}: ${row.amount} ${row.currency}`,
    });
    return row;
  }

  /**
   * Budgets at or past their alert threshold.
   *
   * Compared in SQL against the exact numerics. This used to page the first 500
   * budgets and divide `Number(spentAmount)` by `Number(amount)` — floats in a
   * module built on BigInt, and budget 501 never alerted at all.
   */
  async atRisk() {
    const rows = await this.finance.budgetsAtRisk();
    return rows.map((budget) => ({
      budget,
      usedPct: percentageOf(budget.spentAmount, budget.amount),
    }));
  }
}
