import {
  budgets,
  currencies,
  financialAccounts,
  financialCategories,
  financialCategoryKind,
  fxRates,
  invoiceLineItems,
  invoiceStatus,
  invoices,
  payments,
  recurrenceFrequency,
  recurringTransactions,
  transactionKind,
  transactionStatus,
  transactions,
} from './finance.schema';

describe('finance schema', () => {
  it('tracks income as a first-class transaction kind', () => {
    expect(transactionKind.enumValues).toEqual([
      'income',
      'expense',
      'transfer',
    ]);
    expect(financialCategoryKind.enumValues).toEqual([
      'income',
      'expense',
      'transfer',
    ]);
  });

  it('supports recurring income and expenses', () => {
    // Without a schedule, income tracking only ever sees money that already
    // arrived: nothing can be forecast and a missed receipt is invisible.
    expect(recurringTransactions).toBeDefined();
    expect(recurrenceFrequency.enumValues).toContain('monthly');
  });

  it('references the CRM from the ledger', () => {
    expect(transactions.contactId).toBeDefined();
    expect(transactions.companyId).toBeDefined();
  });

  it('requires a currency alongside every amount', () => {
    expect(transactions.currency.notNull).toBe(true);
    expect(invoices.currency.notNull).toBe(true);
    expect(financialAccounts.currency.notNull).toBe(true);
  });

  it('defines the settlement lifecycles', () => {
    expect(transactionStatus.enumValues).toEqual([
      'draft',
      'pending',
      'cleared',
      'reconciled',
      'void',
    ]);
    expect(invoiceStatus.enumValues).toContain('partially_paid');
  });

  it('exposes the remaining finance tables', () => {
    expect(currencies).toBeDefined();
    expect(fxRates).toBeDefined();
    expect(financialCategories).toBeDefined();
    expect(budgets).toBeDefined();
    expect(invoiceLineItems).toBeDefined();
    expect(payments).toBeDefined();
  });
});
