import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A decimal amount as a string — never a float. See `money.util.ts`. */
const amount = z
  .string()
  .regex(
    /^-?\d{1,16}(\.\d{1,4})?$/,
    'amount must be a decimal with <= 4 places',
  );
const positiveAmount = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,4})?$/, 'amount must be a positive decimal');
const currency = z.string().length(3).toUpperCase();
/**
 * A tax rate as a decimal string, bounded by VALUE and not merely by digit
 * count. The pattern alone admits anything under 1000, so a line at 900% was
 * booked without complaint.
 */
const taxRatePct = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, 'expected a decimal percentage')
  .refine((v) => Number(v) <= 100, 'tax rate cannot exceed 100%')
  .default('0');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const ACCOUNT_KINDS = [
  'bank',
  'cash',
  'credit_card',
  'receivable',
  'payable',
  'other',
] as const;
export const TRANSACTION_KINDS = ['income', 'expense', 'transfer'] as const;
export const TRANSACTION_STATUSES = [
  'draft',
  'pending',
  'cleared',
  'reconciled',
  'void',
] as const;

export const createAccountSchema = z.object({
  name: z.string().min(1).max(150),
  kind: z.enum(ACCOUNT_KINDS).default('bank'),
  currency,
  openingBalance: amount.default('0'),
  institution: z.string().max(150).optional(),
  /** Masked reference only — never a full account number. */
  accountRef: z.string().max(120).optional(),
});

export class CreateAccountDto extends createZodDto(createAccountSchema) {}

export const createTransactionSchema = z
  .object({
    kind: z.enum(TRANSACTION_KINDS),
    occurredOn: isoDate,
    /** Always positive; `kind` carries the sign. */
    amount: positiveAmount,
    currency,
    accountId: z.string().uuid(),
    counterAccountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    /** Payer for income, payee for spending — the CRM reference. */
    contactId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    description: z.string().min(1).max(500),
    reference: z.string().max(120).optional(),
    receiptFileId: z.string().uuid().optional(),
    status: z.enum(TRANSACTION_STATUSES).default('draft'),
    baseAmount: amount.optional(),
    fxRate: z
      .string()
      .regex(/^\d+(\.\d{1,10})?$/)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'transfer' && !v.counterAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counterAccountId'],
        message: 'A transfer needs the account it moves to',
      });
    }
    if (v.counterAccountId && v.counterAccountId === v.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counterAccountId'],
        message: 'A transfer cannot target the same account',
      });
    }
  });

export class CreateTransactionDto extends createZodDto(
  createTransactionSchema,
) {}

export const listTransactionsSchema = z.object({
  kind: z.enum(TRANSACTION_KINDS).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export class ListTransactionsDto extends createZodDto(listTransactionsSchema) {}

export const createBudgetSchema = z.object({
  name: z.string().min(1).max(150),
  projectId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  periodStart: isoDate,
  periodEnd: isoDate,
  amount: positiveAmount,
  currency,
  alertThresholdPct: z.coerce.number().int().min(1).max(100).default(80),
});

export class CreateBudgetDto extends createZodDto(createBudgetSchema) {}

/**
 * Budget listing parameters.
 *
 * The route read `@Query('page')` and `@Query('limit')` as raw strings and
 * passed them through `Number(...)`, so `?limit=abc` reached the repository as
 * `NaN` and `?limit=1e9` was unbounded — the only list endpoint in the module
 * without the caps the others get from their DTO.
 */
export const listBudgetsSchema = z.object({
  projectId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListBudgetsDto extends createZodDto(listBudgetsSchema) {}

export const createRecurringSchema = z.object({
  name: z.string().min(1).max(150),
  kind: z.enum(TRANSACTION_KINDS),
  amount: positiveAmount,
  currency,
  frequency: z.enum([
    'weekly',
    'fortnightly',
    'monthly',
    'quarterly',
    'yearly',
  ]),
  dayOfPeriod: z.coerce.number().int().min(1).max(31).optional(),
  startDate: isoDate,
  endDate: isoDate.optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  /** False = forecast only; nothing posts without confirmation. */
  autoPost: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

export class CreateRecurringDto extends createZodDto(createRecurringSchema) {}

export const createInvoiceSchema = z
  .object({
    contactId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    issueDate: isoDate,
    dueDate: isoDate,
    currency,
    notes: z.string().max(20_000).optional(),
    terms: z.string().max(20_000).optional(),
  })
  .refine((v) => v.contactId || v.companyId, {
    message: 'An invoice needs a bill-to contact or company',
    path: ['contactId'],
  });

export class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}

export const addLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: positiveAmount,
  unit: z.string().max(40).optional(),
  unitPrice: positiveAmount,
  taxRatePct,
  taskId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

export class AddLineItemDto extends createZodDto(addLineItemSchema) {}

export const billTimeSchema = z.object({
  projectId: z.string().uuid(),
  /** Entries to bill; each is locked to the resulting line item. */
  timeEntryIds: z.array(z.string().uuid()).min(1).max(500),
  description: z.string().min(1).max(500),
  unitPrice: positiveAmount,
  taxRatePct,
});

export class BillTimeDto extends createZodDto(billTimeSchema) {}

export const recordPaymentSchema = z.object({
  amount: positiveAmount,
  currency,
  paidAt: z.coerce.date(),
  method: z
    .enum(['bank_transfer', 'card', 'cash', 'cheque', 'other'])
    .default('bank_transfer'),
  reference: z.string().max(120).optional(),
  /** Post a matching ledger entry into this account. */
  accountId: z.string().uuid().optional(),
});

export class RecordPaymentDto extends createZodDto(recordPaymentSchema) {}

export const listInvoicesSchema = z.object({
  status: z
    .enum(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void'])
    .optional(),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListInvoicesDto extends createZodDto(listInvoicesSchema) {}

export const reportSchema = z.object({
  from: isoDate,
  to: isoDate,
  projectId: z.string().uuid().optional(),
});

export class ReportDto extends createZodDto(reportSchema) {}

/**
 * One observed rate for a currency pair on a date.
 *
 * The archive is append-only by design (§12.1) so a report over last quarter
 * uses last quarter's rates. Re-recording the same pair on the same date
 * corrects that day's observation rather than adding a second, because the
 * unique index on (base_code, quote_code, as_of) means the alternative is a
 * constraint violation rather than a second opinion.
 *
 * Recording a rate does NOT make the ledger convert with it: transactions
 * still carry a caller-supplied `fxRate`. This table is the historical record
 * those figures should be reconciled against.
 */
export const upsertFxRateSchema = z.object({
  baseCode: z.string().length(3).toUpperCase(),
  quoteCode: z.string().length(3).toUpperCase(),
  /** Up to 10 decimal places — thin-traded pairs need them. */
  rate: z
    .string()
    .regex(/^\d+(\.\d{1,10})?$/, 'expected a decimal rate')
    .refine((v) => Number(v) > 0, 'rate must be greater than zero'),
  asOf: isoDate,
  source: z.string().min(1).max(80).optional(),
});

export class UpsertFxRateDto extends createZodDto(upsertFxRateSchema) {}
