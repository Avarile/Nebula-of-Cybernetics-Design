import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { contactCompanies, contacts } from './contact.schema';
import { files } from './file.schema';
import { users } from './identity.schema';
import { projects, tasks } from './project.schema';

/**
 * Operational finance: budgets, spending, income, billable work, invoicing and
 * payments. Deliberately NOT statutory double-entry bookkeeping — a signed
 * single-entry ledger with reversing corrections. The upgrade path, if audited
 * accounts are ever required, is to keep `transactions` as the document layer
 * and add `journal_entries` + `journal_lines` beneath it.
 *
 * Money rules, applied without exception:
 *  - `numeric(20, 4)`, never a float. Four decimals absorb unit prices and FX
 *    without premature rounding; presentation rounds to the currency's minor unit.
 *  - Every amount is accompanied by a `currency` on the same row. There is no
 *    implicit currency anywhere.
 *  - Cross-currency rows also store `base_amount` + `fx_rate` + `fx_rate_at`, so
 *    a report over last quarter uses last quarter's rates.
 *  - Amounts are immutable once `cleared`; corrections are reversing entries.
 */

export const accountKind = pgEnum('account_kind', [
  'bank',
  'cash',
  'credit_card',
  'receivable',
  'payable',
  'other',
]);

export const financialCategoryKind = pgEnum('financial_category_kind', [
  'income',
  'expense',
  'transfer',
]);

export const budgetStatus = pgEnum('budget_status', [
  'draft',
  'active',
  'closed',
  'exceeded',
]);

export const transactionKind = pgEnum('transaction_kind', [
  'income',
  'expense',
  'transfer',
]);

export const transactionStatus = pgEnum('transaction_status', [
  'draft',
  'pending',
  'cleared',
  'reconciled',
  'void',
]);

export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
]);

export const paymentMethod = pgEnum('payment_method', [
  'bank_transfer',
  'card',
  'cash',
  'cheque',
  'other',
]);

/** Cadence of a recurring income or expense. */
export const recurrenceFrequency = pgEnum('recurrence_frequency', [
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'yearly',
]);

/**
 * ISO-4217 reference data. Money columns hold the code directly rather than a
 * foreign key: a FK on every amount-bearing row costs a lookup per insert for a
 * value already validated at the request boundary. The base currency is a
 * `system_settings` row (`finance.base_currency`), not a constant.
 */
export const currencies = pgTable('currencies', {
  code: varchar('code', { length: 3 }).primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  symbol: varchar('symbol', { length: 8 }),
  minorUnit: integer('minor_unit').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
});

/**
 * Historical rates, append-only. Kept because a system holding only current
 * rates silently rewrites its own history every day.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    baseCode: varchar('base_code', { length: 3 }).notNull(),
    quoteCode: varchar('quote_code', { length: 3 }).notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    asOf: date('as_of').notNull(),
    source: varchar('source', { length: 80 }),
  },
  (t) => [
    uniqueIndex('fx_rates_pair_date_idx').on(t.baseCode, t.quoteCode, t.asOf),
    index('fx_rates_as_of_idx').on(t.asOf),
  ],
);

/**
 * Where money sits. Single-currency by design: multi-currency holdings are
 * separate accounts, because one balance mixing units is meaningless.
 */
export const financialAccounts = pgTable(
  'financial_accounts',
  {
    ...baseColumns,
    name: varchar('name', { length: 150 }).notNull(),
    kind: accountKind('kind').notNull().default('bank'),
    currency: varchar('currency', { length: 3 }).notNull(),
    openingBalance: numeric('opening_balance', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    /** Denormalized, updated in the same transaction as each posting and
     * reconcilable by summing `transactions`. Recomputing every balance from the
     * ledger on read does not survive growth. */
    currentBalance: numeric('current_balance', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    institution: varchar('institution', { length: 150 }),
    /** Masked reference only — never a full account number. */
    accountRef: varchar('account_ref', { length: 120 }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('financial_accounts_kind_idx').on(t.kind)],
);

/**
 * Income and expense categories, as a materialized-path tree. `kind` separates
 * revenue from spend so income reporting is a filter, not a convention.
 */
export const financialCategories = pgTable(
  'financial_categories',
  {
    ...baseColumns,
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    kind: financialCategoryKind('kind').notNull(),
    description: varchar('description', { length: 500 }),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => financialCategories.id,
    ),
    path: varchar('path', { length: 500 }).notNull().default('/'),
    depth: integer('depth').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    uniqueIndex('financial_categories_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('financial_categories_kind_idx').on(t.kind),
    index('financial_categories_path_idx').on(t.path),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    ...baseColumns,
    name: varchar('name', { length: 150 }).notNull(),
    /** Null for departmental budgets that are not project-scoped. */
    projectId: uuid('project_id').references(() => projects.id),
    categoryId: uuid('category_id').references(() => financialCategories.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    /** Denormalized from cleared transactions; rebuildable. */
    spentAmount: numeric('spent_amount', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    status: budgetStatus('status').notNull().default('active'),
  },
  (t) => [
    index('budgets_project_period_idx').on(
      t.projectId,
      t.periodStart,
      t.periodEnd,
    ),
    index('budgets_category_idx').on(t.categoryId),
  ],
);

/**
 * The operational ledger: one signed row per movement, income and expense
 * alike. `contactId` / `companyId` record the payer for income and the payee
 * for spending, which is how finance references the CRM.
 */
export const transactions = pgTable(
  'transactions',
  {
    ...baseColumns,
    kind: transactionKind('kind').notNull(),
    /** The accounting date, distinct from `createdAt` (when it was entered).
     * Backdated entries are normal and must not reorder history. */
    occurredOn: date('occurred_on').notNull(),
    /** Always positive; `kind` carries the sign. A signed amount PLUS a kind is
     * two sources of truth that will eventually disagree. */
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    baseAmount: numeric('base_amount', { precision: 20, scale: 4 }),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
    fxRateAt: date('fx_rate_at'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => financialAccounts.id),
    /** Required when `kind = 'transfer'`. */
    counterAccountId: uuid('counter_account_id').references(
      () => financialAccounts.id,
    ),
    categoryId: uuid('category_id').references(() => financialCategories.id),
    projectId: uuid('project_id').references(() => projects.id),
    taskId: uuid('task_id').references(() => tasks.id),
    /** Payer (income) or payee (expense). */
    contactId: uuid('contact_id').references(() => contacts.id),
    companyId: uuid('company_id').references(() => contactCompanies.id),
    invoiceId: uuid('invoice_id').references((): AnyPgColumn => invoices.id),
    description: varchar('description', { length: 500 }).notNull(),
    reference: varchar('reference', { length: 120 }),
    receiptFileId: uuid('receipt_file_id').references(() => files.id),
    status: transactionStatus('status').notNull().default('draft'),
    /** A correction is a reversing entry, never an edit of a settled row. */
    reversesTransactionId: uuid('reverses_transaction_id').references(
      (): AnyPgColumn => transactions.id,
    ),
    /** Set when this row was generated from a `recurring_transactions` schedule. */
    recurringTransactionId: uuid('recurring_transaction_id').references(
      (): AnyPgColumn => recurringTransactions.id,
    ),
    createdBy: uuid('created_by').references(() => users.id),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('transactions_account_date_idx').on(t.accountId, t.occurredOn),
    index('transactions_project_date_idx').on(t.projectId, t.occurredOn),
    index('transactions_category_idx').on(t.categoryId, t.occurredOn),
    index('transactions_contact_idx').on(t.contactId),
    index('transactions_company_idx').on(t.companyId),
    index('transactions_invoice_idx').on(t.invoiceId),
    /** Income reporting is a first-class query, not a scan filtered in memory. */
    index('transactions_kind_date_idx').on(t.kind, t.occurredOn),
    index('transactions_status_idx')
      .on(t.status)
      .where(sql`${t.status} <> 'reconciled'`),
    check('transactions_amount_positive_ck', sql`${t.amount} >= 0`),
  ],
);

/**
 * Expected, repeating money: retainers and salary on the income side,
 * subscriptions and rent on the expense side. Without it "income tracking"
 * only ever sees money that has already arrived, so nothing can be forecast and
 * a missed receipt is invisible.
 *
 * The scheduler materializes a `transactions` row per occurrence (marked
 * `pending` until confirmed) and advances `nextDueOn`.
 */
export const recurringTransactions = pgTable(
  'recurring_transactions',
  {
    ...baseColumns,
    name: varchar('name', { length: 150 }).notNull(),
    kind: transactionKind('kind').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    frequency: recurrenceFrequency('frequency').notNull(),
    /** Anchor day-of-month/week, interpreted per `frequency`. */
    dayOfPeriod: integer('day_of_period'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    nextDueOn: date('next_due_on'),
    lastGeneratedOn: date('last_generated_on'),
    accountId: uuid('account_id').references(() => financialAccounts.id),
    categoryId: uuid('category_id').references(() => financialCategories.id),
    projectId: uuid('project_id').references(() => projects.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    companyId: uuid('company_id').references(() => contactCompanies.id),
    /** False = the schedule only forecasts; nothing is posted automatically. */
    autoPost: boolean('auto_post').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    description: varchar('description', { length: 500 }),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    index('recurring_transactions_due_idx')
      .on(t.nextDueOn)
      .where(sql`${t.isActive} = true AND ${t.isDeleted} = false`),
    index('recurring_transactions_kind_idx').on(t.kind),
    index('recurring_transactions_contact_idx').on(t.contactId),
  ],
);

/**
 * Accounts receivable. Immutable once it leaves `draft`: changes are a void
 * plus a new invoice, because an issued invoice is a document someone else
 * holds a copy of.
 */
export const invoices = pgTable(
  'invoices',
  {
    ...baseColumns,
    /** Allocated from a `system_settings` template inside the issuing
     * transaction — gapless numbering is an audit expectation. */
    number: varchar('number', { length: 60 }).notNull(),
    contactId: uuid('contact_id').references(() => contacts.id),
    companyId: uuid('company_id').references(() => contactCompanies.id),
    projectId: uuid('project_id').references(() => projects.id),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    subtotal: numeric('subtotal', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    taxTotal: numeric('tax_total', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 20, scale: 4 }).notNull().default('0'),
    amountPaid: numeric('amount_paid', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    status: invoiceStatus('status').notNull().default('draft'),
    /** Name, address and tax number AS AT ISSUE. A customer that moves must not
     * retroactively alter an invoice already sent. */
    billToSnapshot: jsonb('bill_to_snapshot')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    notes: text('notes'),
    terms: text('terms'),
    pdfFileId: uuid('pdf_file_id').references(() => files.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('invoices_number_idx')
      .on(t.number)
      .where(sql`${t.isDeleted} = false`),
    index('invoices_contact_idx').on(t.contactId),
    index('invoices_company_idx').on(t.companyId),
    index('invoices_project_idx').on(t.projectId),
    index('invoices_overdue_idx')
      .on(t.dueDate)
      .where(sql`${t.status} IN ('sent', 'partially_paid')`),
  ],
);

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    ...baseColumns,
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 500 }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull(),
    unit: varchar('unit', { length: 40 }),
    unitPrice: numeric('unit_price', { precision: 20, scale: 4 }).notNull(),
    taxRatePct: numeric('tax_rate_pct', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    /** Stored, not derived on read: rounding must not vary by reader. */
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 20, scale: 4 }).notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    projectId: uuid('project_id').references(() => projects.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('invoice_line_items_invoice_idx').on(t.invoiceId, t.sortOrder)],
);

export const payments = pgTable(
  'payments',
  {
    ...baseColumns,
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    /** The ledger row this payment produced. Unique, so one transaction cannot
     * settle two invoices. */
    transactionId: uuid('transaction_id').references(() => transactions.id),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    method: paymentMethod('method').notNull().default('bank_transfer'),
    reference: varchar('reference', { length: 120 }),
    recordedBy: uuid('recorded_by').references(() => users.id),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    uniqueIndex('payments_transaction_idx')
      .on(t.transactionId)
      .where(sql`${t.transactionId} IS NOT NULL AND ${t.isDeleted} = false`),
  ],
);

export type CurrencyRow = typeof currencies.$inferSelect;
export type NewCurrencyRow = typeof currencies.$inferInsert;
export type FxRateRow = typeof fxRates.$inferSelect;
export type NewFxRateRow = typeof fxRates.$inferInsert;
export type FinancialAccountRow = typeof financialAccounts.$inferSelect;
export type NewFinancialAccountRow = typeof financialAccounts.$inferInsert;
export type FinancialCategoryRow = typeof financialCategories.$inferSelect;
export type NewFinancialCategoryRow = typeof financialCategories.$inferInsert;
export type BudgetRow = typeof budgets.$inferSelect;
export type NewBudgetRow = typeof budgets.$inferInsert;
export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type RecurringTransactionRow = typeof recurringTransactions.$inferSelect;
export type NewRecurringTransactionRow =
  typeof recurringTransactions.$inferInsert;
export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoiceRow = typeof invoices.$inferInsert;
export type InvoiceLineItemRow = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItemRow = typeof invoiceLineItems.$inferInsert;
export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
