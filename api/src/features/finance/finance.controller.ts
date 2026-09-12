import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { RequirePermission } from '../authorization/require-permission.decorator';
import {
  CreateAccountDto,
  CreateBudgetDto,
  CreateRecurringDto,
  CreateTransactionDto,
  ListBudgetsDto,
  ListTransactionsDto,
  ReportDto,
  UpsertFxRateDto,
  TRANSACTION_STATUSES,
} from './dto/finance.dto';
import { BudgetService } from './budget.service';
import { FinanceRepository } from './finance.repository';
import { LedgerService } from './ledger.service';
import { RecurringService } from './recurring.service';

/**
 * Accounts, the ledger, budgets, recurring schedules and reporting.
 *
 * Financial data is not row-scoped the way projects are: holding
 * `finance.read` is what grants access, and it is granted by role rather than
 * by membership.
 *
 * Every route here is `@Roles('user', 'admin')` and gated by its permission.
 * `@Roles` matches the coarse `users.role` claim, NOT the RBAC role key, so
 * narrowing a route to `@Roles('admin')` does not restrict it to privileged
 * users — it excludes every non-admin regardless of what they hold. Three
 * routes were written that way and made `finance.fx.manage` unreachable: the
 * permission was seeded, granted to `finance_manager`, and could never be
 * exercised by anyone, because a finance manager's `users.role` is `'user'`.
 * The permission is the gate; the role list must stay wide enough to reach it.
 */
@ApiTags('Finance')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly budgetService: BudgetService,
    private readonly recurring: RecurringService,
    private readonly repo: FinanceRepository,
  ) {}

  @ApiOperation({ summary: 'List currencies' })
  @Get('currencies')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  currencies() {
    return this.repo.listCurrencies();
  }

  /**
   * The historical rate archive (design §12.1).
   *
   * Read is `finance.read`; writing is gated separately on `finance.fx.manage`
   * because a wrong rate silently misstates every cross-currency report drawn
   * against that date, which is a different blast radius from recording a
   * transaction.
   */
  @ApiOperation({ summary: 'List recorded exchange rates' })
  @Get('fx-rates')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  fxRates(
    @Query('baseCode') baseCode?: string,
    @Query('quoteCode') quoteCode?: string,
  ) {
    return this.repo.listFxRates({ baseCode, quoteCode });
  }

  @ApiOperation({ summary: 'Record an exchange rate' })
  @Post('fx-rates')
  @Roles('user', 'admin')
  @RequirePermission('finance.fx.manage')
  recordFxRate(@Body() dto: UpsertFxRateDto) {
    return this.repo.upsertFxRate(dto);
  }

  @ApiOperation({ summary: 'List financial categories' })
  @Get('categories')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  categories(@Query('kind') kind?: 'income' | 'expense' | 'transfer') {
    return this.repo.listCategories(kind);
  }

  // --- accounts ---

  @ApiOperation({ summary: 'List accounts' })
  @Get('accounts')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  accounts() {
    return this.ledger.listAccounts();
  }

  @ApiOperation({ summary: 'Create an account' })
  @Post('accounts')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.create')
  createAccount(@Body() dto: CreateAccountDto) {
    return this.ledger.createAccount(dto);
  }

  @ApiOperation({ summary: 'Reconcile an account balance against the ledger' })
  @Get('accounts/:id/reconcile')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  reconcile(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.reconcileAccount(id);
  }

  // --- transactions ---

  @ApiOperation({ summary: 'List transactions' })
  @Get('transactions')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  transactions(@Query() query: ListTransactionsDto) {
    return this.ledger.list(query);
  }

  @ApiOperation({ summary: 'Record income or spending' })
  @Post('transactions')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.create')
  createTransaction(
    @Body() dto: CreateTransactionDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.ledger.create(dto, principal);
  }

  @ApiOperation({ summary: 'Get a transaction' })
  @Get('transactions/:id')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  transaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.get(id);
  }

  /**
   * `status` is validated against the same list the DTOs use. Left raw it
   * reached a Postgres enum column and surfaced as SQLSTATE 22P02 — a 500 for
   * what is plainly a bad request.
   */
  @ApiOperation({ summary: 'Clear, reconcile or void a transaction' })
  @Post('transactions/:id/status/:status')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.update')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('status', new ParseEnumPipe(TRANSACTION_STATUSES))
    status: (typeof TRANSACTION_STATUSES)[number],
    @CurrentUser() principal: Principal,
  ) {
    return this.ledger.setStatus(id, status, principal);
  }

  @ApiOperation({ summary: 'Reverse a settled transaction' })
  @Post('transactions/:id/reverse')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.update')
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.ledger.reverse(id, principal);
  }

  // --- budgets ---

  @ApiOperation({ summary: 'List budgets' })
  @Get('budgets')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  budgets(@Query() query: ListBudgetsDto) {
    return this.budgetService.list(query.projectId, query.page, query.limit);
  }

  @ApiOperation({ summary: 'Create a budget' })
  @Post('budgets')
  @Roles('user', 'admin')
  @RequirePermission('finance.budget.manage')
  createBudget(
    @Body() dto: CreateBudgetDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.budgetService.create(dto, principal);
  }

  @ApiOperation({ summary: 'Budgets at or past their alert threshold' })
  @Get('budgets/at-risk')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  budgetsAtRisk() {
    return this.budgetService.atRisk();
  }

  // --- recurring ---

  @ApiOperation({ summary: 'List recurring income and expenses' })
  @Get('recurring')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  recurringList() {
    return this.recurring.list();
  }

  @ApiOperation({ summary: 'Schedule recurring income or expense' })
  @Post('recurring')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.create')
  createRecurring(
    @Body() dto: CreateRecurringDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.recurring.create(dto, principal);
  }

  @ApiOperation({ summary: 'Stop a recurring schedule' })
  @Delete('recurring/:id')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.update')
  @HttpCode(204)
  async removeRecurring(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.recurring.remove(id);
  }

  @ApiOperation({ summary: 'Generate due recurring transactions now' })
  @Post('recurring/materialize')
  @Roles('user', 'admin')
  @RequirePermission('finance.transaction.create')
  materialize() {
    return this.recurring.materializeDue();
  }

  // --- reporting ---

  @ApiOperation({ summary: 'Income and expense summary' })
  @Get('reports/summary')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  summary(@Query() query: ReportDto) {
    return this.ledger.summary(query.from, query.to, query.projectId);
  }

  @ApiOperation({ summary: 'Income by category' })
  @Get('reports/income-by-category')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  incomeByCategory(@Query() query: ReportDto) {
    // `projectId` is declared by ReportDto and advertised on this route; it was
    // accepted and then dropped, so the filter silently did nothing.
    return this.ledger.categoryBreakdown(
      query.from,
      query.to,
      'income',
      query.projectId,
    );
  }

  @ApiOperation({ summary: 'Spending by category' })
  @Get('reports/spend-by-category')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  spendByCategory(@Query() query: ReportDto) {
    return this.ledger.categoryBreakdown(
      query.from,
      query.to,
      'expense',
      query.projectId,
    );
  }

  @ApiOperation({ summary: 'Expected income and expenses ahead' })
  @Get('reports/forecast')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  forecast(@Query() query: ReportDto) {
    return this.recurring.forecast(new Date(query.from), new Date(query.to));
  }
}
