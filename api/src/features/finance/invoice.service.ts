import { Inject, Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { InvoiceRow } from '../../infrastructure/database/schema/finance.schema';
import { ContactCompanyService } from '../contacts/contact-company.service';
import { ContactService } from '../contacts/contact.service';
import { ProjectLinkRepository } from '../projects/project-link.repository';
import { ProjectLinkService } from '../projects/project-link.service';
import { ActivityService } from '../shared/activity.service';
import type {
  AddLineItemDto,
  BillTimeDto,
  CreateInvoiceDto,
  ListInvoicesDto,
} from './dto/finance.dto';
import { InvoiceRepository } from './invoice.repository';
import { LedgerService } from './ledger.service';
import {
  add,
  compare,
  minutesToHours,
  multiply,
  percentOf,
  sum,
} from './money.util';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: InvoiceRepository,
    // `LedgerService`, not `LedgerRepository`. Posting straight to the
    // repository skipped `applyEffects`, so a recorded payment inserted a
    // `cleared` income row that never moved the account balance.
    private readonly ledger: LedgerService,
    // The repository for the writes that must join this module's transactions
    // (`markBilled`, `releaseBilled`); the service for every READ, because that
    // is where project membership is enforced.
    private readonly timeEntries: ProjectLinkRepository,
    private readonly projectLinks: ProjectLinkService,
    private readonly contacts: ContactService,
    private readonly companies: ContactCompanyService,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  async list(dto: ListInvoicesDto) {
    const { rows, total } = await this.repo.list(dto);
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async get(id: string): Promise<InvoiceRow> {
    const row = await this.repo.findById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async detail(id: string) {
    const invoice = await this.get(id);
    const [lineItems, payments] = await Promise.all([
      this.repo.lineItems(id),
      this.repo.listPayments(id),
    ]);
    return { invoice, lineItems, payments };
  }

  /**
   * Create a draft invoice.
   *
   * The bill-to details are snapshotted now, not resolved at render time: a
   * customer that moves must not retroactively change an invoice already
   * issued.
   */
  async create(
    dto: CreateInvoiceDto,
    principal: Principal,
  ): Promise<InvoiceRow> {
    const snapshot = await this.billToSnapshot(dto, principal);
    const row = await this.repo.create({
      ...dto,
      // Allocated at issue, not at creation: a draft that is never sent must
      // not consume a number, or the sequence gains gaps.
      number: `DRAFT-${Date.now()}`,
      billToSnapshot: snapshot,
      createdBy: userIdOrNull(principal),
    });
    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: row.id,
      projectId: row.projectId,
      action: 'finance.invoice_created',
    });
    return row;
  }

  async addLineItem(
    invoiceId: string,
    dto: AddLineItemDto,
    principal: Principal,
  ) {
    const invoice = await this.requireDraft(invoiceId);
    const amount = multiply(dto.unitPrice, dto.quantity);
    const taxAmount = percentOf(amount, dto.taxRatePct);

    // The line and the header totals it changes commit together. `recalculate`
    // ran after the caller's transaction closed, on the pool: if it threw, the
    // line existed against stale totals, and concurrent adds could interleave
    // and leave the subtotal short by a line.
    const item = await this.db.transaction(async (tx) => {
      const created = await this.repo.addLineItem(
        {
          invoiceId,
          description: dto.description,
          quantity: dto.quantity,
          unit: dto.unit,
          unitPrice: dto.unitPrice,
          taxRatePct: dto.taxRatePct,
          // Stored, not derived on read: rounding must not vary by reader.
          amount,
          taxAmount,
          total: add(amount, taxAmount),
          taskId: dto.taskId,
          projectId: dto.projectId ?? invoice.projectId,
        },
        tx,
      );
      await this.recalculate(invoiceId, tx);
      return created;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'finance.invoice_line_added',
    });
    return item;
  }

  /**
   * Remove a draft line, returning any time it billed to the unbilled pool.
   *
   * `unbilledFor` treats `invoice_line_item_id IS NULL` as the double-billing
   * lock, so hours billed to a deleted line stayed stamped with a soft-deleted
   * line id: invisible to every future invoice, unbillable for good. All three
   * writes share one transaction — a released entry whose line still exists is
   * the double-billing the lock exists to stop.
   */
  async removeLineItem(invoiceId: string, itemId: string): Promise<void> {
    await this.requireDraft(invoiceId);
    const released = await this.db.transaction(async (tx) => {
      const removed = await this.repo.removeLineItem(itemId, tx);
      if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
      const ids = await this.timeEntries.releaseBilled(itemId, tx);
      await this.recalculate(invoiceId, tx);
      return ids;
    });
    if (released.length > 0) {
      this.logger.log(
        `Released ${released.length} time entr(ies) from invoice line ${itemId}`,
      );
    }
  }

  /**
   * Turn logged time into an invoice line.
   *
   * Stamping `invoice_line_item_id` on each entry is the double-billing lock:
   * a billed entry disappears from `unbilledFor`, so the same hour cannot reach
   * a second invoice. Both writes share one transaction, because a line item
   * without its lock is exactly the failure the lock exists to prevent.
   */
  async billTime(invoiceId: string, dto: BillTimeDto, principal: Principal) {
    const invoice = await this.requireDraft(invoiceId);
    // Through `ProjectLinkService`, which enforces project membership. Reading
    // the repository directly let anyone holding `finance.invoice.manage` bill
    // hours from a project they were not a member of, because the repository
    // never sees a principal.
    const available = await this.projectLinks.unbilledFor(
      dto.projectId,
      principal,
    );
    const byId = new Map(available.map((e) => [e.id, e]));

    const selected = dto.timeEntryIds.map((id) => {
      const entry = byId.get(id);
      if (!entry) {
        // Either it does not exist, is not billable, or is already invoiced —
        // all three are the same answer to the caller.
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: `Time entry ${id} is not available to bill`,
        });
      }
      return entry;
    });

    const totalMinutes = selected.reduce((acc, e) => acc + e.minutes, 0);
    // BigInt division, not `(minutes / 60).toFixed(4)`. This was the one
    // arithmetic path in the billing chain that went through a float.
    const hours = minutesToHours(totalMinutes);
    const amount = multiply(dto.unitPrice, hours);
    const taxAmount = percentOf(amount, dto.taxRatePct);

    const item = await this.db.transaction(async (tx) => {
      const created = await this.repo.addLineItem(
        {
          invoiceId,
          description: dto.description,
          quantity: hours,
          unit: 'hour',
          unitPrice: dto.unitPrice,
          taxRatePct: dto.taxRatePct,
          amount,
          taxAmount,
          total: add(amount, taxAmount),
          projectId: dto.projectId,
        },
        tx,
      );
      // `tx`, not the bare connection: the line item and the locks it depends
      // on have to commit or roll back together.
      const claimed = await this.timeEntries.markBilled(
        selected.map((e) => e.id),
        created.id,
        tx,
      );
      // `unbilledFor` read these a moment ago; another bill may have claimed
      // them since. Claiming fewer than asked means exactly that, and rolling
      // back is the only answer that does not bill one piece of work twice.
      if (claimed.length !== selected.length) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message:
            'Some time entries were billed by another invoice; nothing was changed',
        });
      }
      await this.recalculate(invoiceId, tx);
      return created;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: invoiceId,
      projectId: invoice.projectId,
      action: 'finance.time_billed',
      summary: `${totalMinutes} minutes across ${selected.length} entries`,
    });
    return item;
  }

  /**
   * Issue an invoice: allocate its number and freeze it.
   *
   * After this the invoice is read-only. Changes are a void plus a new invoice,
   * because an issued invoice is a document someone else holds a copy of.
   */
  async issue(id: string, principal: Principal): Promise<InvoiceRow> {
    const invoice = await this.requireDraft(id);
    const lineItems = await this.repo.lineItems(id);
    if (lineItems.length === 0) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'An invoice needs at least one line before it can be issued',
      });
    }

    const row = await this.db.transaction(async (tx) => {
      const prefix = `INV-${new Date(invoice.issueDate).getFullYear()}`;
      const number = await this.repo.nextNumber(prefix, tx);
      // Conditional on the invoice still being a draft. `requireDraft` ran
      // before the transaction opened, so two concurrent issues both passed it,
      // both took a number under the advisory lock, and the second overwrote
      // the first — the number the loser consumed then existed nowhere, which
      // is the sequence gap the lock is there to prevent. Failing here rolls
      // the transaction back and hands the number straight back.
      const updated = await this.repo.updateFromStatus(
        id,
        'draft',
        { number, status: 'sent', sentAt: new Date() },
        tx,
      );
      if (!updated) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: 'The invoice was issued by another request',
        });
      }
      return updated;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: id,
      projectId: row.projectId,
      action: 'finance.invoice_issued',
      summary: row.number,
    });
    return row;
  }

  /**
   * Void an invoice that has taken no money.
   *
   * The old guard excluded only `paid`, so a `partially_paid` invoice voided
   * cleanly while its payments and their `cleared` income stayed posted: the
   * balance kept the money for an invoice that officially did not happen. Any
   * settled payment now blocks the void.
   *
   * Auto-reversing the postings would be wrong — this module corrects money
   * with explicit reversing entries, never as a side effect of a status change.
   */
  async void(id: string, principal: Principal): Promise<InvoiceRow> {
    const invoice = await this.get(id);
    if (invoice.status === 'void') return invoice;
    if (invoice.status === 'paid') {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'A paid invoice cannot be voided; refund it instead',
      });
    }
    if (compare(invoice.amountPaid, '0') > 0) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message:
          `Invoice ${invoice.number} has ${invoice.amountPaid} ${invoice.currency} ` +
          'recorded against it. Reverse those payments before voiding it, or ' +
          'the ledger keeps money for an invoice that does not exist.',
      });
    }
    const row = await this.repo.updateFromStatus(id, invoice.status, {
      status: 'void',
      voidedAt: new Date(),
    });
    if (!row) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'The invoice changed while it was being voided',
      });
    }
    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: id,
      action: 'finance.invoice_voided',
    });
    return row;
  }

  /** Invoices past due — the reminder sweep's input. */
  overdue() {
    return this.repo.overdue(new Date().toISOString().slice(0, 10));
  }

  /**
   * Recompute the header totals from the lines, exactly.
   *
   * Takes the caller's executor: read and write share the transaction of the
   * line change that triggered them.
   *
   * `total` is summed from the stored per-line totals rather than derived as
   * `subtotal + taxTotal` — deriving it agrees with the lines by construction,
   * so it could never reveal a line whose own total had drifted.
   */
  private async recalculate(
    invoiceId: string,
    executor: DrizzleExecutor,
  ): Promise<void> {
    const items = await this.repo.lineItems(invoiceId, executor);
    await this.repo.update(
      invoiceId,
      {
        subtotal: sum(items.map((i) => i.amount)),
        taxTotal: sum(items.map((i) => i.taxAmount)),
        total: sum(items.map((i) => i.total)),
      },
      executor,
    );
  }

  private async requireDraft(id: string): Promise<InvoiceRow> {
    const invoice = await this.get(id);
    if (invoice.status !== 'draft') {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Invoice ${invoice.number} is ${invoice.status} and is read-only`,
      });
    }
    return invoice;
  }

  /** Bill-to details as they stand now, frozen onto the invoice. */
  private async billToSnapshot(
    dto: CreateInvoiceDto,
    principal: Principal,
  ): Promise<Record<string, unknown>> {
    if (dto.companyId) {
      const company = await this.companies.get(dto.companyId);
      return {
        kind: 'company',
        name: company.legalName ?? company.name,
        address: company.address,
        taxNumber: company.taxNumber,
      };
    }
    const contact = await this.contacts.get(dto.contactId!, principal);
    return {
      kind: 'contact',
      name: contact.displayName,
      email: contact.primaryEmail,
    };
  }
}
