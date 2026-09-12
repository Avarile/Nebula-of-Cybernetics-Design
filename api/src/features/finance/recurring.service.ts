import { Inject, Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  RecurringTransactionRow,
  TransactionRow,
} from '../../infrastructure/database/schema/finance.schema';
import { SystemEventService } from '../system/system-event.service';
import type { CreateRecurringDto } from './dto/finance.dto';
import { LedgerRepository } from './ledger.repository';
import { LedgerService } from './ledger.service';

/** Advance a date by one period. */
export function nextOccurrence(
  from: Date,
  frequency: RecurringTransactionRow['frequency'],
): Date {
  const next = new Date(from);
  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'fortnightly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

/**
 * Expected, repeating money — retainers and salary on the income side,
 * subscriptions and rent on the expense side.
 *
 * Without this, income tracking only ever sees money that has already arrived:
 * nothing can be forecast, and a receipt that never turns up is
 * indistinguishable from one that was never due.
 */
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: LedgerRepository,
    // `LedgerService`, not just the repository. A schedule that posts settled
    // money has to move a balance, and only this service knows how.
    private readonly ledger: LedgerService,
    private readonly events: SystemEventService,
    private readonly errors: ExceptionService,
  ) {}

  list(activeOnly = true) {
    return this.repo.listRecurring(activeOnly);
  }

  async create(dto: CreateRecurringDto, principal: Principal) {
    return this.repo.createRecurring({
      ...dto,
      // The first occurrence is the start date itself.
      nextDueOn: dto.startDate,
      createdBy: userIdOrNull(principal),
    });
  }

  async setActive(id: string, isActive: boolean) {
    const row = await this.repo.updateRecurring(id, { isActive });
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async remove(id: string): Promise<void> {
    const row = await this.repo.findRecurring(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.repo.softDeleteRecurring(id);
  }

  /**
   * Materialize every schedule whose occurrence has arrived.
   *
   * Idempotent through `lastGeneratedOn`: a sweep that runs twice in one day
   * generates nothing the second time. Without that guard, a retried job
   * double-posts real money.
   *
   * `autoPost` decides whether the generated row is `pending` (a forecast
   * awaiting confirmation) or `cleared`. It defaults to false, because a
   * schedule that posts unattended turns a forecast into a ledger entry nobody
   * checked, and undoing it costs a reversing entry.
   */
  async materializeDue(today = new Date()): Promise<TransactionRow[]> {
    const asDate = today.toISOString().slice(0, 10);
    const due = await this.repo.dueRecurring(asDate);
    const created: TransactionRow[] = [];

    for (const schedule of due) {
      if (schedule.lastGeneratedOn === schedule.nextDueOn) {
        // Already generated for this occurrence; only the cursor is behind.
        await this.advance(schedule);
        continue;
      }
      if (schedule.endDate && schedule.nextDueOn! > schedule.endDate) {
        await this.repo.updateRecurring(schedule.id, { isActive: false });
        continue;
      }
      if (!schedule.accountId) {
        this.logger.warn(
          `Recurring "${schedule.name}" has no account; skipping generation`,
        );
        continue;
      }

      // An autoPost schedule writes a settled row, so it must satisfy the same
      // guard every other settled posting does: the account has to exist and
      // hold the schedule's currency. Posting through the repository skipped
      // this entirely.
      try {
        await this.ledger.requireAccountFor(
          schedule.accountId,
          schedule.currency,
        );
      } catch {
        this.logger.warn(
          `Recurring "${schedule.name}" targets an account that cannot hold ` +
            `${schedule.currency}; skipping generation`,
        );
        continue;
      }

      const row = await this.materializeOne(schedule);
      if (row) created.push(row);
    }

    if (created.length > 0) {
      await this.events.emit({
        source: 'recurring.service',
        eventKey: 'finance.recurring_materialized',
        message: `Generated ${created.length} recurring transaction(s)`,
        payload: { transactionIds: created.map((t) => t.id) },
      });
    }
    return created;
  }

  /**
   * Generate one occurrence: claim it, then post it, in a single transaction.
   *
   * The claim goes FIRST and is conditional on the cursor the caller read. Two
   * concurrent sweeps both see the same due row, but only one of them can move
   * `next_due_on` off the value they both read — the loser claims nothing and
   * generates nothing. Because the posting shares the transaction, a failure
   * there rolls the claim back and the occurrence stays available.
   *
   * The previous version ran `create` and `advance` as two statements with no
   * transaction between them, so a crash in the gap left `lastGeneratedOn`
   * behind `nextDueOn` and the next sweep posted the same money again.
   */
  private async materializeOne(
    schedule: RecurringTransactionRow,
  ): Promise<TransactionRow | null> {
    const occurrence = schedule.nextDueOn!;
    const next = nextOccurrence(new Date(occurrence), schedule.frequency);

    return this.db.transaction(async (tx) => {
      const claimed = await this.repo.claimOccurrence(
        schedule.id,
        occurrence,
        {
          lastGeneratedOn: occurrence,
          nextDueOn: next.toISOString().slice(0, 10),
        },
        tx,
      );
      if (!claimed) {
        this.logger.debug(
          `Occurrence ${occurrence} of "${schedule.name}" was taken by another sweep`,
        );
        return null;
      }

      // `LedgerService.postSettled`, not `LedgerRepository.create`. Writing the
      // row directly meant an autoPost schedule inserted a `cleared`
      // transaction that never reached `applyEffects`: no balance movement, no
      // budget accrual. That is the identical defect invoice payments carried
      // until they were moved onto this method, and it survived here because
      // the bypass was at the injection site rather than in the call.
      return this.ledger.postSettled(
        {
          kind: schedule.kind,
          occurredOn: occurrence,
          amount: schedule.amount,
          currency: schedule.currency,
          accountId: schedule.accountId!,
          categoryId: schedule.categoryId,
          projectId: schedule.projectId,
          contactId: schedule.contactId,
          companyId: schedule.companyId,
          description: schedule.description ?? schedule.name,
          status: schedule.autoPost ? 'cleared' : 'pending',
          recurringTransactionId: schedule.id,
          createdBy: schedule.createdBy,
        },
        tx,
      );
    });
  }

  /** Move the cursor forward without generating anything. */
  private async advance(schedule: RecurringTransactionRow): Promise<void> {
    const current = schedule.nextDueOn ?? schedule.startDate;
    const next = nextOccurrence(new Date(current), schedule.frequency);
    await this.repo.updateRecurring(schedule.id, {
      lastGeneratedOn: current,
      nextDueOn: next.toISOString().slice(0, 10),
    });
  }

  /**
   * Expected income over a window, from the schedules.
   *
   * The forecast half of income tracking: what should arrive, against what the
   * ledger says did.
   */
  async forecast(
    from: Date,
    to: Date,
  ): Promise<
    Array<{ name: string; kind: string; amount: string; dueOn: string }>
  > {
    const schedules = await this.repo.listRecurring(true);
    const out: Array<{
      name: string;
      kind: string;
      amount: string;
      dueOn: string;
    }> = [];

    for (const schedule of schedules) {
      let cursor = new Date(schedule.nextDueOn ?? schedule.startDate);
      // Bounded: a weekly schedule over a long window would otherwise run away.
      for (let i = 0; i < 200 && cursor <= to; i++) {
        if (cursor >= from) {
          out.push({
            name: schedule.name,
            kind: schedule.kind,
            amount: schedule.amount,
            dueOn: cursor.toISOString().slice(0, 10),
          });
        }
        cursor = nextOccurrence(cursor, schedule.frequency);
      }
    }
    return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }
}
