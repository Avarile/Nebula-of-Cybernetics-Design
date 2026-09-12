import { Inject, Injectable } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  InvoiceRow,
  PaymentRow,
} from '../../infrastructure/database/schema/finance.schema';
import { ActivityService } from '../shared/activity.service';
import type { RecordPaymentDto } from './dto/finance.dto';
import { InvoiceRepository } from './invoice.repository';
import { LedgerService } from './ledger.service';
import { compare, subtract } from './money.util';

/**
 * Recording money against an invoice.
 *
 * Split out of `InvoiceService` alongside `BudgetService`: the invoice
 * lifecycle (draft, lines, issue, void) and the settlement of an issued invoice
 * are separate concerns, and settlement is the one that touches the ledger.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: InvoiceRepository,
    // `LedgerService`, not `LedgerRepository`. Posting straight to the
    // repository skipped `applyEffects`, so a recorded payment inserted a
    // `cleared` income row that never moved the account balance.
    private readonly ledger: LedgerService,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  private async get(id: string): Promise<InvoiceRow> {
    const row = await this.repo.findById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  /**
   * Record a payment, optionally posting the matching ledger entry.
   *
   * The payment, the invoice's paid total and the ledger row all move together:
   * an invoice that says paid with nothing in the ledger behind it is how the
   * two halves of a finance module drift apart.
   */
  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
    principal: Principal,
  ): Promise<PaymentRow> {
    const invoice = await this.get(invoiceId);
    if (
      invoice.status === 'draft' ||
      invoice.status === 'void' ||
      invoice.status === 'paid'
    ) {
      // `paid` was missing from this list, so a settled invoice accepted
      // payments indefinitely — 250.0000 invoice, 10000.0000 paid, then another
      // 50.0000 on top, each one posting real income to the ledger.
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Cannot pay a ${invoice.status} invoice`,
      });
    }
    if (dto.currency !== invoice.currency) {
      throw this.errors.validation([
        {
          path: 'currency',
          message: `Invoice is in ${invoice.currency}`,
        },
      ]);
    }

    // The ceiling, checked here for a message the caller can act on and
    // enforced again inside `applyPayment` against the committed row. Nothing
    // bounded this before: a 250.0000 invoice took a 10000.0000 payment, marked
    // itself paid, and moved 10000.0000 of income into the account.
    const outstanding = subtract(invoice.total, invoice.amountPaid);
    if (compare(dto.amount, outstanding) > 0) {
      throw this.errors.validation([
        {
          path: 'amount',
          message: `Invoice ${invoice.number} has ${outstanding} ${invoice.currency} outstanding`,
        },
      ]);
    }

    // Before opening the transaction: an account is single-currency, and until
    // now this path only checked the payment against the *invoice*. Paying a
    // USD invoice into a EUR account posted USD into a EUR balance — harmless
    // while the balance was never touched, corrupting the moment it is.
    if (dto.accountId) {
      await this.ledger.requireAccountFor(dto.accountId, dto.currency);
    }

    const payment = await this.db.transaction(async (tx) => {
      let transactionId: string | null = null;
      if (dto.accountId) {
        const posted = await this.ledger.postSettled(
          {
            kind: 'income',
            occurredOn: dto.paidAt.toISOString().slice(0, 10),
            amount: dto.amount,
            currency: dto.currency,
            accountId: dto.accountId,
            projectId: invoice.projectId,
            contactId: invoice.contactId,
            companyId: invoice.companyId,
            invoiceId,
            description: `Payment for ${invoice.number}`,
            reference: dto.reference,
            status: 'cleared',
            createdBy: userIdOrNull(principal),
          },
          tx,
        );
        transactionId = posted.id;
      }

      const created = await this.repo.addPayment(
        {
          invoiceId,
          transactionId,
          amount: dto.amount,
          currency: dto.currency,
          paidAt: dto.paidAt,
          method: dto.method,
          reference: dto.reference,
          recordedBy: userIdOrNull(principal),
        },
        tx,
      );

      // One relative, guarded statement rather than a total computed here from
      // a row read before the transaction opened. Two concurrent payments both
      // read `amountPaid` as 0.0000 and both wrote their own absolute total, so
      // one vanished from the header while its row and its posting survived.
      const updated = await this.repo.applyPayment(
        invoiceId,
        dto.amount,
        dto.paidAt,
        tx,
      );
      if (!updated) {
        // The pre-checks passed, so the invoice moved underneath us: another
        // payment settled it, or took the room this one needed.
        throw this.errors.create(ErrorCode.CONFLICT, {
          message:
            'The invoice was paid by another request; nothing was changed',
        });
      }
      return created;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: invoiceId,
      projectId: invoice.projectId,
      action: 'finance.payment_recorded',
      summary: `${dto.amount} ${dto.currency}`,
    });
    return payment;
  }
}
