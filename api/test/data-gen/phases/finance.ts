import { create, type GenContext } from '../context';
import * as f from '../fake';
import { scaled, VOLUME } from '../volume';

/**
 * The ledger, budgets, recurring schedules, the rate archive and invoicing.
 *
 * Admin-only throughout, and not by preference: the `user` role carries no
 * finance permission at all, so a non-admin cannot open an account or post a
 * transaction. Suite 11 asserts that boundary; here we simply work inside it.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp, pools } = ctx;
  client.beginSuite('finance');

  // Currency and categories are seeded reference data — read them rather than
  // assume them, so a differently seeded environment still generates cleanly.
  const currencies = await client.call({
    name: 'read currencies',
    method: 'GET',
    path: '/finance/currencies',
    actor: 'admin',
    expect: 200,
  });
  const codes: string[] = Array.isArray(currencies.body)
    ? currencies.body.map((c: any) => c.code).filter(Boolean)
    : [];
  pools.currency = codes.includes('AUD') ? 'AUD' : (codes[0] ?? 'AUD');

  const categories = await client.call({
    name: 'read financial categories',
    method: 'GET',
    path: '/finance/categories',
    actor: 'admin',
    expect: 200,
  });
  pools.categoryIds = Array.isArray(categories.body)
    ? categories.body.map((c: any) => c.id).filter(Boolean)
    : [];

  const KINDS = [
    'bank',
    'cash',
    'credit_card',
    'receivable',
    'payable',
    'other',
  ] as const;
  for (let i = 0; i < scaled(VOLUME.accounts); i += 1) {
    const id = await create(ctx, 'financial_accounts', {
      name: `account ${i}`,
      method: 'POST',
      path: '/finance/accounts',
      actor: 'admin',
      body: {
        name: `${f.pick(['Operating', 'Reserve', 'Payroll', 'Petty cash', 'Card'], i)} ${i} ${stamp}`,
        kind: f.pick(KINDS, i),
        currency: pools.currency,
        openingBalance: f.money(5_000 + i * 1_250),
        institution: f.pick(['Westpac', 'CBA', 'NAB', 'ANZ', 'Macquarie'], i),
        accountRef: `****${String(1000 + i).slice(-4)}`,
      },
      expect: 201,
    });
    if (id) pools.accountIds.push(id);
  }

  await fxRates(ctx);

  if (pools.accountIds.length < 2) return;
  await transactions(ctx);
  await budgetsAndRecurring(ctx);
  await invoices(ctx);
}

/**
 * The historical rate archive.
 *
 * Recording a rate does not make the ledger convert with it — transactions
 * still carry a caller-supplied `fxRate`. This is the record those figures are
 * meant to be reconciled against, which is why it is worth having at all.
 */
async function fxRates(ctx: GenContext): Promise<void> {
  const PAIRS: Array<[string, string]> = [
    ['AUD', 'USD'],
    ['AUD', 'NZD'],
    ['AUD', 'GBP'],
    ['AUD', 'EUR'],
    ['AUD', 'SGD'],
    ['USD', 'EUR'],
    ['USD', 'GBP'],
    ['GBP', 'EUR'],
  ];
  for (let i = 0; i < scaled(VOLUME.fxRates); i += 1) {
    const [base, quote] = PAIRS[i % PAIRS.length];
    const drift = 1 + Math.sin(i / 7) * 0.05;
    await create(ctx, 'fx_rates', {
      name: `fx ${base}/${quote} ${i}`,
      method: 'POST',
      path: '/finance/fx-rates',
      actor: 'admin',
      body: {
        baseCode: base,
        quoteCode: quote,
        rate: (0.65 * drift).toFixed(10),
        // One observation per pair per day; the unique index means a repeat on
        // the same date corrects rather than duplicates.
        asOf: f.isoDate(-Math.floor(i / PAIRS.length)),
        source: 'data-gen',
      },
      expect: [200, 201],
    });
  }
}

async function transactions(ctx: GenContext): Promise<void> {
  const { pools } = ctx;
  const KINDS = ['income', 'expense', 'expense', 'transfer'] as const;
  const created: string[] = [];

  for (let i = 0; i < scaled(VOLUME.transactions); i += 1) {
    const kind = f.pick(KINDS, i);
    const accountId = f.pick(pools.accountIds, i);
    let counterAccountId: string | undefined;
    if (kind === 'transfer') {
      counterAccountId = pools.accountIds.find((a) => a !== accountId);
      if (!counterAccountId) continue;
    }
    const id = await create(ctx, 'transactions', {
      name: `transaction ${i}`,
      method: 'POST',
      path: '/finance/transactions',
      actor: 'admin',
      body: {
        kind,
        occurredOn: f.isoDate(-(i % 180)),
        amount: f.money(50 + ((i * 37) % 4_500) + 0.25),
        currency: pools.currency,
        accountId,
        ...(counterAccountId ? { counterAccountId } : {}),
        ...(pools.categoryIds.length && kind !== 'transfer'
          ? { categoryId: f.pick(pools.categoryIds, i) }
          : {}),
        ...(pools.projectIds.length && i % 4 === 0
          ? { projectId: f.pick(pools.projectIds, i) }
          : {}),
        ...(pools.contactIds.length && i % 5 === 0
          ? { contactId: f.pick(pools.contactIds, i * 3) }
          : {}),
        ...(pools.companyIds.length && i % 7 === 0
          ? { companyId: f.pick(pools.companyIds, i) }
          : {}),
        description: `${kind === 'income' ? 'Receipt for' : 'Spend on'} ${f.topic(i)} (${i})`,
        reference: `GEN-${ctx.stamp}-${i}`,
        status: 'draft',
      },
      expect: 201,
    });
    if (id) created.push(id);
  }

  // Walk a realistic spread of them through the status machine, so the ledger
  // is not a uniform wall of drafts and `cleared` balances actually move.
  const FLOW = ['pending', 'cleared', 'reconciled'] as const;
  for (let i = 0; i < created.length; i += 1) {
    if (i % 3 !== 0) continue;
    for (const status of FLOW.slice(0, (i % 3) + 1)) {
      await create(ctx, 'transaction_status', {
        name: `transaction ${i} -> ${status}`,
        method: 'POST',
        path: '/finance/transactions/{id}/status/{status}',
        params: { id: created[i], status },
        actor: 'admin',
        body: undefined,
        expect: [200, 201, 204, 400, 409, 422],
      });
    }
  }
}

async function budgetsAndRecurring(ctx: GenContext): Promise<void> {
  const { pools, stamp } = ctx;
  for (let i = 0; i < scaled(VOLUME.budgets); i += 1) {
    await create(ctx, 'budgets', {
      name: `budget ${i}`,
      method: 'POST',
      path: '/finance/budgets',
      actor: 'admin',
      body: {
        name: `${f.topic(i)} budget ${i} ${stamp}`,
        periodStart: f.isoDate(-(30 + (i % 6) * 30)),
        periodEnd: f.isoDate(30 + (i % 6) * 30),
        amount: f.money(10_000 + i * 2_500),
        currency: pools.currency,
        alertThresholdPct: 50 + ((i * 7) % 45),
        ...(pools.projectIds.length && i % 2 === 0
          ? { projectId: f.pick(pools.projectIds, i) }
          : {}),
        ...(pools.categoryIds.length && i % 2 === 1
          ? { categoryId: f.pick(pools.categoryIds, i) }
          : {}),
      },
      expect: 201,
    });
  }

  const FREQ = [
    'weekly',
    'fortnightly',
    'monthly',
    'quarterly',
    'yearly',
  ] as const;
  for (let i = 0; i < scaled(VOLUME.recurring); i += 1) {
    await create(ctx, 'recurring_transactions', {
      name: `recurring ${i}`,
      method: 'POST',
      path: '/finance/recurring',
      actor: 'admin',
      body: {
        name: `${f.pick(['Retainer', 'Licence', 'Hosting', 'Insurance', 'Rent'], i)} ${i}`,
        kind: i % 3 === 0 ? 'income' : 'expense',
        amount: f.money(250 + i * 125),
        currency: pools.currency,
        frequency: f.pick(FREQ, i),
        dayOfPeriod: (i % 28) + 1,
        startDate: f.isoDate(-(60 + i)),
        endDate: f.isoDate(300 + i),
        // Forecast only unless explicitly confirmed — nothing posts by itself.
        autoPost: i % 6 === 0,
        description: `Recurring ${f.topic(i)}.`,
        ...(pools.accountIds.length
          ? { accountId: f.pick(pools.accountIds, i) }
          : {}),
        ...(pools.categoryIds.length
          ? { categoryId: f.pick(pools.categoryIds, i) }
          : {}),
      },
      expect: 201,
    });
  }
}

async function invoices(ctx: GenContext): Promise<void> {
  const { pools } = ctx;
  if (pools.contactIds.length === 0 && pools.companyIds.length === 0) return;

  for (let i = 0; i < scaled(VOLUME.invoices); i += 1) {
    const id = await create(ctx, 'invoices', {
      name: `invoice ${i}`,
      method: 'POST',
      path: '/invoices',
      actor: 'admin',
      body: {
        issueDate: f.isoDate(-(i % 90)),
        dueDate: f.isoDate(30 - (i % 90)),
        currency: pools.currency,
        notes: `Invoice for ${f.topic(i)}.`,
        terms: 'Net 30. Interest applies after the due date.',
        ...(i % 2 === 0 && pools.contactIds.length
          ? { contactId: f.pick(pools.contactIds, i * 3) }
          : { companyId: f.pick(pools.companyIds, i) }),
        ...(pools.projectIds.length && i % 3 === 0
          ? { projectId: f.pick(pools.projectIds, i) }
          : {}),
      },
      expect: 201,
    });
    if (id) pools.invoiceIds.push(id);
  }

  if (pools.invoiceIds.length === 0) return;

  for (let i = 0; i < scaled(VOLUME.invoiceLines); i += 1) {
    await create(ctx, 'invoice_line_items', {
      name: `invoice line ${i}`,
      method: 'POST',
      path: '/invoices/{id}/lines',
      params: { id: f.pick(pools.invoiceIds, i) },
      actor: 'admin',
      body: {
        description: `${f.pick(['Consulting', 'Implementation', 'Support', 'Licence'], i)} — ${f.topic(i)}`,
        quantity: f.money(1 + (i % 12)),
        unit: f.pick(['hour', 'day', 'item', 'month'], i),
        unitPrice: f.money(120 + (i % 9) * 45),
        taxRatePct: f.pick(['0.000', '10.000', '15.000'], i),
      },
      expect: 201,
    });
  }

  // Bill real logged time onto a few invoices, which stamps the time entries
  // and moves them out of the unbilled report.
  const billable = pools.timeEntryIds.slice(0, 40);
  for (
    let i = 0;
    i < Math.min(8, pools.invoiceIds.length) && pools.projectIds.length;
    i += 1
  ) {
    const slice = billable.slice(i * 4, i * 4 + 4);
    if (slice.length === 0) break;
    await create(ctx, 'invoice_billed_time', {
      name: `bill time onto invoice ${i}`,
      method: 'POST',
      path: '/invoices/{id}/bill-time',
      params: { id: pools.invoiceIds[i] },
      actor: 'admin',
      body: {
        projectId: f.pick(pools.projectIds, i),
        timeEntryIds: slice,
        description: `Engineering time — ${f.topic(i)}`,
        unitPrice: f.money(185),
        taxRatePct: '10.000',
      },
      expect: [200, 201, 400, 409, 422],
    });
  }

  const METHODS = ['bank_transfer', 'card', 'cash', 'cheque', 'other'] as const;
  for (let i = 0; i < scaled(VOLUME.payments); i += 1) {
    const invoiceId = f.pick(pools.invoiceIds, i);
    // An invoice must be issued before it can be paid.
    if (i % 3 === 0) {
      await create(ctx, 'invoice_issued', {
        name: `issue invoice ${i}`,
        method: 'POST',
        path: '/invoices/{id}/issue',
        params: { id: invoiceId },
        actor: 'admin',
        body: {},
        expect: [200, 201, 204, 400, 409, 422],
      });
    }
    await create(ctx, 'payments', {
      name: `payment ${i}`,
      method: 'POST',
      path: '/invoices/{id}/payments',
      params: { id: invoiceId },
      actor: 'admin',
      body: {
        amount: f.money(100 + (i % 15) * 75),
        currency: pools.currency,
        paidAt: f.isoDateTime(-(i % 45)),
        method: f.pick(METHODS, i),
        reference: `PAY-${ctx.stamp}-${i}`,
        ...(pools.accountIds.length
          ? { accountId: f.pick(pools.accountIds, i) }
          : {}),
      },
      expect: [201, 200, 400, 409, 422],
    });
  }
}
