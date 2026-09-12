import type { DrizzleDB } from '../drizzle.constants';
import { contactTypes } from '../schema/contact.schema';
import { currencies, financialCategories } from '../schema/finance.schema';
import { knowledgeTypes } from '../schema/knowledge.schema';
import type { Seeder } from './seeder.interface';
import { insertMissingByKey } from './seed.util';

/**
 * Curated vocabularies the application expects to exist: currencies, contact
 * types, knowledge types and financial categories.
 *
 * These are lookup tables rather than enums precisely so admins can extend them
 * without a migration; `is_system` marks the rows shipped here, which the
 * services refuse to delete.
 */
export class ReferenceDataSeeder implements Seeder {
  readonly name = 'reference-data';

  async run(db: DrizzleDB): Promise<void> {
    const currencyCount = await insertMissingByKey(
      db,
      currencies,
      currencies.code,
      [
        { code: 'AUD', name: 'Australian Dollar', symbol: '$', minorUnit: 2 },
        {
          code: 'USD',
          name: 'United States Dollar',
          symbol: '$',
          minorUnit: 2,
        },
        { code: 'EUR', name: 'Euro', symbol: '€', minorUnit: 2 },
        { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnit: 2 },
        { code: 'NZD', name: 'New Zealand Dollar', symbol: '$', minorUnit: 2 },
        { code: 'SGD', name: 'Singapore Dollar', symbol: '$', minorUnit: 2 },
        { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnit: 0 },
        { code: 'CNY', name: 'Renminbi', symbol: '¥', minorUnit: 2 },
      ],
      (r) => r.code,
    );

    const contactTypeCount = await insertMissingByKey(
      db,
      contactTypes,
      contactTypes.key,
      [
        { key: 'lead', name: 'Lead', sortOrder: 10, isSystem: true },
        { key: 'prospect', name: 'Prospect', sortOrder: 20, isSystem: true },
        { key: 'client', name: 'Client', sortOrder: 30, isSystem: true },
        { key: 'supplier', name: 'Supplier', sortOrder: 40, isSystem: true },
        { key: 'partner', name: 'Partner', sortOrder: 50, isSystem: true },
        { key: 'employee', name: 'Employee', sortOrder: 60, isSystem: true },
        { key: 'advisor', name: 'Advisor', sortOrder: 70, isSystem: true },
        { key: 'other', name: 'Other', sortOrder: 99, isSystem: true },
      ],
      (r) => r.key,
    );

    /** `defaultReviewIntervalDays` is what schedules `knowledge.review_due`:
     * a policy needs annual review, a meeting note never does. */
    const knowledgeTypeCount = await insertMissingByKey(
      db,
      knowledgeTypes,
      knowledgeTypes.key,
      [
        {
          key: 'article',
          name: 'Article',
          defaultReviewIntervalDays: 365,
          sortOrder: 10,
          isSystem: true,
        },
        {
          key: 'runbook',
          name: 'Runbook',
          defaultReviewIntervalDays: 180,
          sortOrder: 20,
          isSystem: true,
        },
        {
          key: 'policy',
          name: 'Policy',
          defaultReviewIntervalDays: 365,
          sortOrder: 30,
          isSystem: true,
        },
        { key: 'faq', name: 'FAQ', sortOrder: 40, isSystem: true },
        {
          key: 'meeting_note',
          name: 'Meeting Note',
          sortOrder: 50,
          isSystem: true,
        },
        {
          key: 'research',
          name: 'Research',
          defaultReviewIntervalDays: 365,
          sortOrder: 60,
          isSystem: true,
        },
        { key: 'template', name: 'Template', sortOrder: 70, isSystem: true },
        {
          key: 'decision_record',
          name: 'Decision Record',
          sortOrder: 80,
          isSystem: true,
        },
      ],
      (r) => r.key,
    );

    /** Income first: the ledger tracks money in as deliberately as money out. */
    const categoryCount = await insertMissingByKey(
      db,
      financialCategories,
      financialCategories.key,
      [
        {
          key: 'client_revenue',
          name: 'Client Revenue',
          kind: 'income' as const,
          path: '/client_revenue',
          sortOrder: 10,
          isSystem: true,
        },
        {
          key: 'retainer',
          name: 'Retainer',
          kind: 'income' as const,
          path: '/retainer',
          sortOrder: 20,
          isSystem: true,
        },
        {
          key: 'product_sales',
          name: 'Product Sales',
          kind: 'income' as const,
          path: '/product_sales',
          sortOrder: 30,
          isSystem: true,
        },
        {
          key: 'interest_income',
          name: 'Interest Income',
          kind: 'income' as const,
          path: '/interest_income',
          sortOrder: 40,
          isSystem: true,
        },
        {
          key: 'other_income',
          name: 'Other Income',
          kind: 'income' as const,
          path: '/other_income',
          sortOrder: 90,
          isSystem: true,
        },
        {
          key: 'salaries',
          name: 'Salaries',
          kind: 'expense' as const,
          path: '/salaries',
          sortOrder: 110,
          isSystem: true,
        },
        {
          key: 'contractors',
          name: 'Contractors',
          kind: 'expense' as const,
          path: '/contractors',
          sortOrder: 120,
          isSystem: true,
        },
        {
          key: 'software',
          name: 'Software & Subscriptions',
          kind: 'expense' as const,
          path: '/software',
          sortOrder: 130,
          isSystem: true,
        },
        {
          key: 'infrastructure',
          name: 'Hosting & Infrastructure',
          kind: 'expense' as const,
          path: '/infrastructure',
          sortOrder: 140,
          isSystem: true,
        },
        {
          key: 'travel',
          name: 'Travel',
          kind: 'expense' as const,
          path: '/travel',
          sortOrder: 150,
          isSystem: true,
        },
        {
          key: 'marketing',
          name: 'Marketing',
          kind: 'expense' as const,
          path: '/marketing',
          sortOrder: 160,
          isSystem: true,
        },
        {
          key: 'office',
          name: 'Office & Equipment',
          kind: 'expense' as const,
          path: '/office',
          sortOrder: 170,
          isSystem: true,
        },
        {
          key: 'taxes',
          name: 'Taxes & Fees',
          kind: 'expense' as const,
          path: '/taxes',
          sortOrder: 180,
          isSystem: true,
        },
        {
          key: 'other_expense',
          name: 'Other Expense',
          kind: 'expense' as const,
          path: '/other_expense',
          sortOrder: 190,
          isSystem: true,
        },
      ],
      (r) => r.key,
    );

    console.log(
      `  ↳ currencies +${currencyCount}, contact types +${contactTypeCount}, ` +
        `knowledge types +${knowledgeTypeCount}, financial categories +${categoryCount}`,
    );
  }
}
