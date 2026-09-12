import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  invoiceLineItems,
  invoices,
  payments,
  type InvoiceLineItemRow,
  type InvoiceRow,
  type NewInvoiceLineItemRow,
  type NewInvoiceRow,
  type NewPaymentRow,
  type PaymentRow,
} from '../../infrastructure/database/schema/finance.schema';

/** Escape a literal for safe inclusion in a POSIX regular expression. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

export interface InvoiceQuery {
  status?: InvoiceRow['status'];
  contactId?: string;
  companyId?: string;
  projectId?: string;
  page: number;
  limit: number;
}

@Injectable()
export class InvoiceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: InvoiceQuery): Promise<{ rows: InvoiceRow[]; total: number }> {
    const filters: SQL[] = [eq(invoices.isDeleted, false)];
    if (q.status) filters.push(eq(invoices.status, q.status));
    if (q.contactId) filters.push(eq(invoices.contactId, q.contactId));
    if (q.companyId) filters.push(eq(invoices.companyId, q.companyId));
    if (q.projectId) filters.push(eq(invoices.projectId, q.projectId));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.issueDate))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(invoices)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Allocate the next invoice number for a year, gaplessly.
   *
   * Serialized on a single advisory-locked read of the maximum, inside the
   * issuing transaction. Gapless numbering is an audit expectation in most
   * jurisdictions, so this must not race — two invoices sharing a number is a
   * far worse failure than a brief wait.
   */
  async nextNumber(
    prefix: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<string> {
    // A transaction-scoped advisory lock keyed by the prefix: concurrent
    // issuers queue rather than both reading the same maximum.
    await executor.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${prefix}`}))`,
    );
    // Match the exact shape before casting, rather than stripping everything up
    // to the last dash and hoping the remainder is an integer. A single invoice
    // numbered `INV-2026-0001-R` made the old `regexp_replace(...)::int` raise
    // SQLSTATE 22P02 and broke issuance for that entire prefix — a
    // non-conforming number now simply does not participate in the maximum.
    const pattern = `^${escapeRegex(prefix)}-[0-9]+$`;
    const result = await executor.execute<{ max: string | null }>(sql`
      SELECT MAX(substring(number from '[0-9]+$')::int)::text AS max
      FROM ${invoices}
      WHERE number ~ ${pattern}
    `);
    const next = Number(result.rows[0]?.max ?? 0) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  }

  async create(
    values: NewInvoiceRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceRow> {
    const rows = await executor.insert(invoices).values(values).returning();
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<NewInvoiceRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceRow | null> {
    const rows = await executor
      .update(invoices)
      .set(patch)
      .where(and(eq(invoices.id, id), eq(invoices.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Patch an invoice only while it is still in the status the caller decided
   * from.
   *
   * `issue()` checked for `draft` outside its transaction and then updated on
   * `id` alone, so two concurrent issues both passed the check, both allocated
   * a number under the advisory lock, and the second overwrote the first — the
   * consumed number then appeared nowhere, which is precisely the gap the lock
   * exists to prevent. Returning null lets the caller fail the transaction and
   * hand the number back.
   */
  async updateFromStatus(
    id: string,
    expected: InvoiceRow['status'],
    patch: Partial<NewInvoiceRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceRow | null> {
    const rows = await executor
      .update(invoices)
      .set(patch)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.isDeleted, false),
          eq(invoices.status, expected),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Apply a payment to the header: one statement that adds, bounds and settles.
   *
   * Every part of this was previously computed in the service from a row read
   * before the transaction opened — `amount_paid` was recalculated in JS and
   * written back as an absolute value, so two concurrent payments both read
   * 0.0000, both wrote their own total, and one payment vanished from the
   * header while its `payments` row and its ledger posting both survived.
   *
   * Three guards live in the predicate, where they are evaluated against the
   * committed row rather than a stale copy:
   *
   *   - `status IN (...)` keeps a draft, a void or an already-settled invoice
   *     from taking money. `paid` is excluded, which is why a 250.0000 invoice
   *     could previously be paid 10000.0000 and then paid again.
   *   - `amount_paid + delta <= total` is the overpayment ceiling.
   *   - the addition is relative, so concurrent payments compose instead of
   *     overwriting one another.
   *
   * Returns null when no row matched. The caller has already read the invoice
   * for a specific message; this is the enforcement, not the explanation.
   */
  async applyPayment(
    id: string,
    amount: string,
    paidAt: Date,
    executor: DrizzleExecutor,
  ): Promise<InvoiceRow | null> {
    const rows = await executor
      .update(invoices)
      .set({
        amountPaid: sql`${invoices.amountPaid} + ${amount}::numeric`,
        // Cast required: both branches are string literals, so Postgres types
        // the CASE as `text` and refuses to assign it to an `invoice_status`
        // column. A branch that referenced the column would anchor the type on
        // its own; neither of these does.
        status: sql`
          CASE
            WHEN ${invoices.amountPaid} + ${amount}::numeric >= ${invoices.total}
            THEN 'paid' ELSE 'partially_paid'
          END::invoice_status
        `,
        paidAt: sql`
          CASE
            WHEN ${invoices.amountPaid} + ${amount}::numeric >= ${invoices.total}
            THEN ${paidAt}::timestamptz ELSE ${invoices.paidAt}
          END
        `,
      })
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.isDeleted, false),
          sql`${invoices.status} IN ('sent', 'partially_paid', 'overdue')`,
          sql`${invoices.amountPaid} + ${amount}::numeric <= ${invoices.total}`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Invoices past their due date and not settled — the reminder sweep. */
  overdue(today: string): Promise<InvoiceRow[]> {
    return this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.isDeleted, false),
          sql`${invoices.status} IN ('sent', 'partially_paid')`,
          sql`${invoices.dueDate} < ${today}`,
        ),
      );
  }

  // --- line items ---

  lineItems(
    invoiceId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceLineItemRow[]> {
    return executor
      .select()
      .from(invoiceLineItems)
      .where(
        and(
          eq(invoiceLineItems.invoiceId, invoiceId),
          eq(invoiceLineItems.isDeleted, false),
        ),
      )
      .orderBy(asc(invoiceLineItems.sortOrder));
  }

  async addLineItem(
    values: NewInvoiceLineItemRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceLineItemRow> {
    const rows = await executor
      .insert(invoiceLineItems)
      .values(values)
      .returning();
    return rows[0];
  }

  async removeLineItem(
    id: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .update(invoiceLineItems)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(invoiceLineItems.id, id), eq(invoiceLineItems.isDeleted, false)),
      )
      .returning({ id: invoiceLineItems.id });
    return rows.length > 0;
  }

  // --- payments ---

  listPayments(invoiceId: string): Promise<PaymentRow[]> {
    return this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.invoiceId, invoiceId), eq(payments.isDeleted, false)),
      )
      .orderBy(desc(payments.paidAt));
  }

  async addPayment(
    values: NewPaymentRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<PaymentRow> {
    const rows = await executor.insert(payments).values(values).returning();
    return rows[0];
  }
}
