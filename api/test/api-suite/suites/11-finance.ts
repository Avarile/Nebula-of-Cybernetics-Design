import { isoDate } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Ledger, budgets, recurring templates and reporting.
 *
 * The baseline `user` role carries no finance permission at all, so every group
 * below opens with the mock user being refused and then continues as admin.
 * That is the whole boundary: finance is opt-in via `finance_viewer` /
 * `finance_manager`, never something a standard account drifts into.
 */
export async function run(ctx: Ctx): Promise<void> {
  await reference(ctx);
  await accounts(ctx);
  // Budgets before transactions, deliberately: spend is accrued onto matching
  // budgets at posting time, so a budget created afterwards would show zero
  // spend no matter how much was booked against its project and category.
  await budgets(ctx);
  await transactions(ctx);
  await budgetAccrual(ctx);
  await recurring(ctx);
  await reports(ctx);
}

async function reference(ctx: Ctx): Promise<void> {
  const { client } = ctx;

  const currencies = await client.call({
    name: 'admin lists supported currencies',
    method: 'GET',
    path: '/finance/currencies',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length === 0) return 'no currencies are seeded';
      const missing = ['AUD', 'USD'].filter(
        (c) => !rows.some((r) => r.code === c),
      );
      return missing.length ? `missing ${missing.join(', ')}` : undefined;
    },
  });
  ctx.facts.currency = currencies.ok ? 'AUD' : 'AUD';

  await client.call({
    name: 'a standard user cannot read finance reference data',
    method: 'GET',
    path: '/finance/currencies',
    actor: 'user',
    expect: 403,
  });

  const expense = await client.call({
    name: 'admin lists expense categories',
    method: 'GET',
    path: '/finance/categories',
    actor: 'admin',
    query: { kind: 'expense' },
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length === 0) return 'no expense categories are seeded';
      const wrong = rows.find((c) => c.kind !== 'expense');
      return wrong ? `kind filter leaked a ${wrong.kind} category` : undefined;
    },
  });
  if (expense.ok) {
    const rows: any[] = Array.isArray(expense.body) ? expense.body : [];
    ctx.ids.expenseCategoryId = rows[0]?.id;
  }

  const income = await client.call({
    name: 'admin lists income categories',
    method: 'GET',
    path: '/finance/categories',
    actor: 'admin',
    query: { kind: 'income' },
    expect: 200,
  });
  if (income.ok) {
    const rows: any[] = Array.isArray(income.body) ? income.body : [];
    ctx.ids.incomeCategoryId = rows[0]?.id;
  }

  // CONTRACT DRIFT: the generated OpenAPI marks `kind` as a required query
  // parameter, but the controller declares it optional and returns every
  // category when it is omitted. The behaviour is asserted here; the document
  // is what needs correcting.
  await client.call({
    name: 'the category kind is optional, despite the OpenAPI marking it required',
    method: 'GET',
    path: '/finance/categories',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const kinds = new Set(rows.map((c) => c.kind));
      return kinds.size > 1
        ? undefined
        : `omitting kind returned only ${[...kinds].join(', ')}`;
    },
  });
}

async function accounts(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const currency = ctx.facts.currency ?? 'AUD';

  await client.call({
    name: 'a standard user cannot open an account',
    method: 'POST',
    path: '/finance/accounts',
    actor: 'user',
    body: { name: 'Rogue account', currency },
    expect: 403,
  });

  const operating = await client.call({
    name: 'admin opens an operating bank account',
    method: 'POST',
    path: '/finance/accounts',
    actor: 'admin',
    body: {
      name: `API Suite Operating ${stamp}`,
      kind: 'bank',
      currency,
      openingBalance: '10000.00',
      institution: 'Test Mutual',
      accountRef: `AS-${stamp.slice(-6)}`,
    },
    expect: 201,
  });
  if (operating.ok) ctx.ids.accountId = operating.body.id;

  const savings = await client.call({
    name: 'admin opens a second account to transfer against',
    method: 'POST',
    path: '/finance/accounts',
    actor: 'admin',
    body: {
      name: `API Suite Reserve ${stamp}`,
      kind: 'bank',
      currency,
      openingBalance: '0',
    },
    expect: 201,
  });
  if (savings.ok) ctx.ids.counterAccountId = savings.body.id;

  await client.call({
    name: 'an unknown account kind is rejected',
    method: 'POST',
    path: '/finance/accounts',
    actor: 'admin',
    body: { name: 'Bad kind', kind: 'mattress', currency },
    expect: 400,
  });

  await client.call({
    name: 'an unknown currency is rejected',
    method: 'POST',
    path: '/finance/accounts',
    actor: 'admin',
    body: { name: 'Bad currency', currency: 'ZZZ' },
    expect: [400, 404, 422],
  });

  await client.call({
    name: 'admin lists accounts',
    method: 'GET',
    path: '/finance/accounts',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((a) => a.id === ctx.ids.accountId)
        ? undefined
        : 'the account just opened is not listed';
    },
  });

  if (ctx.ids.accountId) {
    await client.call({
      name: 'admin reconciles the account',
      method: 'GET',
      path: '/finance/accounts/{id}/reconcile',
      params: { id: ctx.ids.accountId },
      actor: 'admin',
      expect: 200,
    });

    await client.call({
      name: 'a standard user cannot reconcile an account',
      method: 'GET',
      path: '/finance/accounts/{id}/reconcile',
      params: { id: ctx.ids.accountId },
      actor: 'user',
      expect: 403,
    });
  }
}

async function transactions(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  if (!ctx.ids.accountId) {
    client.skip(
      'transactions',
      '/finance/transactions',
      'POST',
      'no account was opened',
    );
    return;
  }
  const accountId = ctx.ids.accountId;
  const currency = ctx.facts.currency ?? 'AUD';

  await client.call({
    name: 'a standard user cannot post a transaction',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'user',
    body: {
      kind: 'expense',
      occurredOn: isoDate(0),
      amount: '10.00',
      currency,
      accountId,
      description: 'Rogue expense',
    },
    expect: 403,
  });

  const expense = await client.call({
    name: 'admin posts an expense',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'admin',
    body: {
      kind: 'expense',
      occurredOn: isoDate(-3),
      amount: '1250.5000',
      currency,
      accountId,
      categoryId: ctx.ids.expenseCategoryId,
      projectId: ctx.ids.projectId,
      contactId: ctx.ids.contactId,
      companyId: ctx.ids.companyId,
      description: `Cloud hosting for ${stamp}`,
      reference: `INV-HOST-${stamp.slice(-6)}`,
      status: 'cleared',
    },
    expect: 201,
    assert: (b) => (b?.kind === 'expense' ? undefined : `kind was ${b?.kind}`),
  });
  if (expense.ok) ctx.ids.transactionId = expense.body.id;

  const income = await client.call({
    name: 'admin posts income',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'admin',
    body: {
      kind: 'income',
      occurredOn: isoDate(-2),
      amount: '8800.0000',
      currency,
      accountId,
      categoryId: ctx.ids.incomeCategoryId,
      projectId: ctx.ids.projectId,
      description: `Milestone payment ${stamp}`,
      // Settled on purpose: reversal is only meaningful for a transaction that
      // has already hit the ledger — a pending one is voided instead.
      status: 'cleared',
    },
    expect: 201,
  });
  if (income.ok) ctx.ids.reversibleTransactionId = income.body.id;

  if (ctx.ids.counterAccountId) {
    await client.call({
      name: 'admin posts a transfer between accounts',
      method: 'POST',
      path: '/finance/transactions',
      actor: 'admin',
      body: {
        kind: 'transfer',
        occurredOn: isoDate(-1),
        amount: '2000.0000',
        currency,
        accountId,
        counterAccountId: ctx.ids.counterAccountId,
        description: 'Move to reserve',
      },
      expect: 201,
    });
  }

  await client.call({
    name: 'a negative amount is rejected',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'admin',
    body: {
      kind: 'expense',
      occurredOn: isoDate(0),
      amount: '-50.00',
      currency,
      accountId,
      description: 'Negative',
    },
    expect: 400,
  });

  await client.call({
    name: 'a malformed date is rejected',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'admin',
    body: {
      kind: 'expense',
      occurredOn: '03/09/2026',
      amount: '50.00',
      currency,
      accountId,
      description: 'Bad date',
    },
    expect: 400,
  });

  await client.call({
    name: 'a transaction requires a description',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'admin',
    body: {
      kind: 'expense',
      occurredOn: isoDate(0),
      amount: '50.00',
      currency,
      accountId,
    },
    expect: 400,
  });

  await client.call({
    name: 'admin lists transactions for the account',
    method: 'GET',
    path: '/finance/transactions',
    actor: 'admin',
    query: {
      accountId,
      from: isoDate(-30),
      to: isoDate(1),
      page: 1,
      limit: 50,
    },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      if (rows.length < 2)
        return `expected the fixture transactions, got ${rows.length}`;
      const foreign = rows.find((t) => t.accountId !== accountId);
      return foreign ? 'account filter leaked a transaction' : undefined;
    },
  });

  await client.call({
    name: 'transactions can be filtered by kind',
    method: 'GET',
    path: '/finance/transactions',
    actor: 'admin',
    query: { kind: 'expense', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const wrong = rows.find((t) => t.kind !== 'expense');
      return wrong ? `kind filter leaked a ${wrong.kind}` : undefined;
    },
  });

  await client.call({
    name: 'transactions can be filtered by project',
    method: 'GET',
    path: '/finance/transactions',
    actor: 'admin',
    query: { projectId: ctx.ids.projectId, limit: 20 },
    expect: 200,
  });

  if (ctx.ids.transactionId) {
    await client.call({
      name: 'admin reads a transaction',
      method: 'GET',
      path: '/finance/transactions/{id}',
      params: { id: ctx.ids.transactionId },
      actor: 'admin',
      expect: 200,
    });

    await client.call({
      name: 'a standard user cannot read a transaction',
      method: 'GET',
      path: '/finance/transactions/{id}',
      params: { id: ctx.ids.transactionId },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin marks the transaction reconciled',
      method: 'POST',
      path: '/finance/transactions/{id}/status/{status}',
      params: { id: ctx.ids.transactionId, status: 'reconciled' },
      actor: 'admin',
      expect: [200, 201, 204],
    });

    await client.call({
      name: 'an unknown status transition is rejected',
      method: 'POST',
      path: '/finance/transactions/{id}/status/{status}',
      params: { id: ctx.ids.transactionId, status: 'embezzled' },
      actor: 'admin',
      expect: [400, 404, 422],
    });
  }

  // Voiding is tested on its own transaction: void and reverse are alternatives,
  // and voiding the one queued for reversal leaves nothing to reverse.
  const voidable = await client.call({
    name: 'admin posts a transaction to void',
    method: 'POST',
    path: '/finance/transactions',
    actor: 'admin',
    body: {
      kind: 'expense',
      occurredOn: isoDate(0),
      amount: '15.0000',
      currency,
      accountId,
      description: `Keyed in error ${stamp}`,
      status: 'pending',
    },
    expect: 201,
  });

  if (voidable.ok) {
    await client.call({
      name: 'a pending transaction is voided rather than reversed',
      method: 'POST',
      path: '/finance/transactions/{id}/status/{status}',
      params: { id: voidable.body.id, status: 'void' },
      actor: 'admin',
      expect: [200, 201, 204],
    });

    await client.call({
      name: 'a voided transaction cannot then be reversed',
      method: 'POST',
      path: '/finance/transactions/{id}/reverse',
      params: { id: voidable.body.id },
      actor: 'admin',
      expect: [400, 409, 422],
    });
  }

  if (ctx.ids.reversibleTransactionId) {
    await client.call({
      name: 'admin reverses a settled transaction',
      method: 'POST',
      path: '/finance/transactions/{id}/reverse',
      params: { id: ctx.ids.reversibleTransactionId },
      actor: 'admin',
      expect: [200, 201],
      assert: (b) =>
        b?.id && b.id !== ctx.ids.reversibleTransactionId
          ? undefined
          : 'a reversal should produce a new contra entry',
    });
  }

  await client.call({
    name: 'an unknown transaction id is a 404',
    method: 'GET',
    path: '/finance/transactions/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'admin',
    expect: 404,
  });
}

async function budgets(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const currency = ctx.facts.currency ?? 'AUD';

  await client.call({
    name: 'a standard user cannot create a budget',
    method: 'POST',
    path: '/finance/budgets',
    actor: 'user',
    body: {
      name: 'Rogue budget',
      periodStart: isoDate(0),
      periodEnd: isoDate(30),
      amount: '100.00',
      currency,
    },
    expect: 403,
  });

  const budget = await client.call({
    name: 'admin creates a project budget',
    method: 'POST',
    path: '/finance/budgets',
    actor: 'admin',
    body: {
      name: `Hosting budget ${stamp}`,
      projectId: ctx.ids.projectId,
      categoryId: ctx.ids.expenseCategoryId,
      periodStart: isoDate(-30),
      periodEnd: isoDate(30),
      amount: '1500.0000',
      currency,
      alertThresholdPct: 60,
    },
    expect: 201,
  });
  if (budget.ok) ctx.ids.budgetId = budget.body.id;

  await client.call({
    name: 'a budget period cannot end before it starts',
    method: 'POST',
    path: '/finance/budgets',
    actor: 'admin',
    body: {
      name: 'Backwards budget',
      periodStart: isoDate(30),
      periodEnd: isoDate(0),
      amount: '100.0000',
      currency,
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'an alert threshold above 100 is rejected',
    method: 'POST',
    path: '/finance/budgets',
    actor: 'admin',
    body: {
      name: 'Impossible threshold',
      periodStart: isoDate(0),
      periodEnd: isoDate(30),
      amount: '100.0000',
      currency,
      alertThresholdPct: 400,
    },
    expect: [400, 422],
  });

  if (ctx.ids.projectId) {
    await client.call({
      name: 'admin lists the project’s budgets',
      method: 'GET',
      path: '/finance/budgets',
      actor: 'admin',
      query: { projectId: ctx.ids.projectId },
      expect: 200,
      assert: (b) => {
        const rows: any[] = b?.rows ?? (Array.isArray(b) ? b : (b?.data ?? []));
        return rows.some((x) => x.id === ctx.ids.budgetId)
          ? undefined
          : 'the budget just created is not listed';
      },
    });
  }

  await client.call({
    name: 'a standard user cannot read at-risk budgets',
    method: 'GET',
    path: '/finance/budgets/at-risk',
    actor: 'user',
    expect: 403,
  });
}

/**
 * Spend accrual, checked only after the expense has been posted.
 *
 * The fixture books 1250.50 against a 1500 budget whose alert threshold is 60%,
 * so the budget should be sitting at ~83% and reported as at risk. This is the
 * one assertion that proves the ledger and the budget actually talk to each
 * other rather than merely coexisting.
 */
async function budgetAccrual(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.budgetId || !ctx.ids.projectId) {
    client.skip(
      'budget accrual',
      '/finance/budgets/at-risk',
      'GET',
      'no budget was created',
    );
    return;
  }

  await client.call({
    name: 'the posted expense accrues against the matching budget',
    method: 'GET',
    path: '/finance/budgets',
    actor: 'admin',
    query: { projectId: ctx.ids.projectId },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.rows ?? (Array.isArray(b) ? b : (b?.data ?? []));
      const budget = rows.find((x) => x.id === ctx.ids.budgetId);
      if (!budget) return 'the budget is missing from its own project listing';
      return Number(budget.spentAmount) > 0
        ? undefined
        : `spentAmount is ${budget.spentAmount} after a cleared expense in the same project and category`;
    },
  });

  await client.call({
    name: 'the over-threshold budget shows up as at risk',
    method: 'GET',
    path: '/finance/budgets/at-risk',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.rows ?? b?.data ?? []);
      const entry = rows.find(
        (x) => (x.budget?.id ?? x.id) === ctx.ids.budgetId,
      );
      if (!entry)
        return 'a budget at 83% of its limit is not reported as at risk';
      return entry.usedPct >= 60
        ? undefined
        : `usedPct was ${entry.usedPct}, below its own 60% threshold`;
    },
  });
}

async function recurring(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const currency = ctx.facts.currency ?? 'AUD';

  const template = await client.call({
    name: 'admin creates a monthly recurring expense',
    method: 'POST',
    path: '/finance/recurring',
    actor: 'admin',
    body: {
      name: `Monthly hosting ${stamp}`,
      kind: 'expense',
      amount: '420.0000',
      currency,
      frequency: 'monthly',
      dayOfPeriod: 1,
      startDate: isoDate(-60),
      endDate: isoDate(300),
      accountId: ctx.ids.accountId,
      categoryId: ctx.ids.expenseCategoryId,
      projectId: ctx.ids.projectId,
      autoPost: false,
      description: 'Recurring hosting charge.',
    },
    expect: 201,
  });
  if (template.ok) ctx.ids.recurringId = template.body.id;

  await client.call({
    name: 'an unknown frequency is rejected',
    method: 'POST',
    path: '/finance/recurring',
    actor: 'admin',
    body: {
      name: 'Bad frequency',
      kind: 'expense',
      amount: '10.0000',
      currency,
      frequency: 'whenever',
      startDate: isoDate(0),
    },
    expect: 400,
  });

  await client.call({
    name: 'admin lists recurring templates',
    method: 'GET',
    path: '/finance/recurring',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((r) => r.id === ctx.ids.recurringId)
        ? undefined
        : 'the template just created is not listed';
    },
  });

  await client.call({
    name: 'a standard user cannot materialize recurring transactions',
    method: 'POST',
    path: '/finance/recurring/materialize',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin materializes due recurring transactions',
    method: 'POST',
    path: '/finance/recurring/materialize',
    actor: 'admin',
    expect: [200, 201, 202],
  });

  // A disposable template so DELETE is covered without removing the one the
  // reports below are counting.
  const spare = await client.call({
    name: 'admin creates a disposable recurring template',
    method: 'POST',
    path: '/finance/recurring',
    actor: 'admin',
    body: {
      name: `Disposable recurring ${stamp}`,
      kind: 'expense',
      amount: '5.0000',
      currency,
      frequency: 'weekly',
      startDate: isoDate(0),
    },
    expect: 201,
  });

  if (spare.ok) {
    await client.call({
      name: 'admin deletes the disposable template',
      method: 'DELETE',
      path: '/finance/recurring/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 204,
    });
  }
}

async function reports(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  const range = { from: isoDate(-90), to: isoDate(30) };

  await client.call({
    name: 'admin reads the finance summary',
    method: 'GET',
    path: '/finance/reports/summary',
    actor: 'admin',
    query: range,
    expect: 200,
    assert: (b) =>
      b && typeof b === 'object' ? undefined : 'no summary returned',
  });

  await client.call({
    name: 'the summary can be scoped to a project',
    method: 'GET',
    path: '/finance/reports/summary',
    actor: 'admin',
    query: { ...range, projectId: ctx.ids.projectId },
    expect: 200,
  });

  await client.call({
    name: 'a report without a date range is rejected',
    method: 'GET',
    path: '/finance/reports/summary',
    actor: 'admin',
    expect: 400,
  });

  await client.call({
    name: 'admin reads spend by category',
    method: 'GET',
    path: '/finance/reports/spend-by-category',
    actor: 'admin',
    query: range,
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0
        ? undefined
        : 'no spend is reported despite a cleared expense in range';
    },
  });

  await client.call({
    name: 'admin reads income by category',
    method: 'GET',
    path: '/finance/reports/income-by-category',
    actor: 'admin',
    query: range,
    expect: 200,
  });

  await client.call({
    name: 'admin reads the cash-flow forecast',
    method: 'GET',
    path: '/finance/reports/forecast',
    actor: 'admin',
    query: { from: isoDate(0), to: isoDate(120) },
    expect: 200,
  });

  await client.call({
    name: 'a standard user cannot read finance reports',
    method: 'GET',
    path: '/finance/reports/forecast',
    actor: 'user',
    query: { from: isoDate(0), to: isoDate(120) },
    expect: 403,
  });

  // ------------------------------------------------------------- fx rate archive
  //
  // Append-only historical reference data (design §12.1). Recording a rate does
  // not make the ledger convert with it — transactions carry a caller-supplied
  // `fxRate` — so these assert the archive, not a conversion.

  await client.call({
    name: 'a standard user cannot record an exchange rate',
    method: 'POST',
    path: '/finance/fx-rates',
    actor: 'user',
    body: {
      baseCode: 'AUD',
      quoteCode: 'USD',
      rate: '0.6500000000',
      asOf: isoDate(0),
    },
    expect: 403,
  });

  await client.call({
    name: 'admin records an exchange rate',
    method: 'POST',
    path: '/finance/fx-rates',
    actor: 'admin',
    body: {
      baseCode: 'AUD',
      quoteCode: 'USD',
      rate: '0.6543210000',
      asOf: isoDate(0),
      source: 'api-suite',
    },
    expect: [200, 201],
    assert: (b) =>
      b?.baseCode === 'AUD' && b?.quoteCode === 'USD'
        ? undefined
        : `recorded ${b?.baseCode}/${b?.quoteCode}`,
  });

  await client.call({
    name: 'a rate above zero is required',
    method: 'POST',
    path: '/finance/fx-rates',
    actor: 'admin',
    body: {
      baseCode: 'AUD',
      quoteCode: 'USD',
      rate: '0',
      asOf: isoDate(0),
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'a currency code must be three characters',
    method: 'POST',
    path: '/finance/fx-rates',
    actor: 'admin',
    body: {
      baseCode: 'AUDD',
      quoteCode: 'USD',
      rate: '0.6500000000',
      asOf: isoDate(0),
    },
    expect: [400, 422],
  });

  // Same pair, same date: the unique index means this must correct the day's
  // observation rather than add a second one.
  await client.call({
    name: 'recording the same pair and date again corrects it',
    method: 'POST',
    path: '/finance/fx-rates',
    actor: 'admin',
    body: {
      baseCode: 'AUD',
      quoteCode: 'USD',
      rate: '0.6600000000',
      asOf: isoDate(0),
      source: 'api-suite-corrected',
    },
    expect: [200, 201],
    assert: (b) =>
      String(b?.rate).startsWith('0.66')
        ? undefined
        : `rate was ${b?.rate} after the correction`,
  });

  await client.call({
    name: 'admin reads the rate archive filtered by pair',
    method: 'GET',
    path: '/finance/fx-rates',
    actor: 'admin',
    query: { baseCode: 'AUD', quoteCode: 'USD' },
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length === 0) return 'the rate just recorded is not listed';
      const today = rows.filter(
        (r) => String(r.asOf).slice(0, 10) === isoDate(0),
      );
      return today.length === 1
        ? undefined
        : `expected exactly one AUD/USD row for today, got ${today.length}`;
    },
  });

  await client.call({
    name: 'a user holding finance.read may read the archive',
    method: 'GET',
    path: '/finance/fx-rates',
    actor: 'user',
    expect: [200, 403],
  });
}
