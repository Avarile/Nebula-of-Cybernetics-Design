import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SchedulingConfig } from '../../config/configurations/scheduling.config';
import type { DrizzleExecutor } from '../../infrastructure/database/drizzle.constants';
import type { ScheduledJobRow } from '../../infrastructure/database/schema/calendar.schema';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import {
  ScheduledJobHandlerRegistry,
  type JobKind,
} from '../../infrastructure/scheduling/job-handler.registry';
import { CalendarRepository } from './calendar.repository';
import { DispatcherService, type TickResult } from './dispatcher.service';
import { MaterializerService } from './materializer.service';
import { ReaperService } from './reaper.service';
import {
  SchedulingRepository,
  type SchedulerHealth,
  type ReapResult,
} from './scheduling.repository';

/**
 * What another module supplies to schedule its own work.
 *
 * Nothing here mentions the calendar unless the caller wants it to. Binding to
 * an `occurrenceId` is the opt-in that buys the staleness check; leaving it out
 * gives a plain durable timer whose handler decides whether the work is still
 * wanted.
 */
export interface ScheduleInput {
  /** The key a handler registered under, e.g. `invoice.chase`. */
  kind: JobKind;
  runAt: Date;
  /**
   * Globally unique. It is what makes a retried caller idempotent, and what
   * `cancel` takes — so derive it from the work, not from a counter:
   * `invoice.chase:{invoiceId}:{stage}`.
   */
  dedupeKey: string;
  /** What the job is about. Enables `cancelBySubject` and `listBySubject`. */
  subject?: { type: string; id: string };
  /**
   * Bind to a calendar instance. The job then carries the event's current
   * version and the dispatcher drops it if the event is edited underneath.
   */
  occurrenceId?: string;
  payload?: Record<string, unknown>;
  /** Defaults to `SCHEDULER_MAX_ATTEMPTS`. */
  maxAttempts?: number;
}

export interface SchedulerStatus extends SchedulerHealth {
  /** True when `overdue5m` has crossed the alert threshold. */
  degraded: boolean;
  registeredKinds: JobKind[];
  /**
   * Kinds with pending work and nobody to run it. Non-empty means a module was
   * removed or renamed and its backlog is quietly accruing.
   */
  orphanedKinds: Array<{ kind: string; count: number }>;
}

/**
 * Operations on scheduled work: the health numbers, the dead-letter queue, and
 * the seam other modules use to schedule their own jobs.
 *
 * The manual `run*` entry points exist because "wait up to six hours to find
 * out whether the fix worked" is not a debugging loop anyone should have.
 */
@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);
  private readonly config: SchedulingConfig;

  constructor(
    private readonly jobs: SchedulingRepository,
    private readonly calendar: CalendarRepository,
    private readonly dispatcher: DispatcherService,
    private readonly materializer: MaterializerService,
    private readonly reaper: ReaperService,
    private readonly handlers: ScheduledJobHandlerRegistry,
    private readonly errors: ExceptionService,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<SchedulingConfig>('scheduling');
  }

  /**
   * Schedule work against an occurrence, at the event's CURRENT version.
   *
   * Reading the version here rather than taking it from the caller is what
   * makes the staleness check meaningful: a job that carries a version its
   * author invented would either never run or never be invalidated.
   */
  async schedule(
    input: ScheduleInput,
    executor?: DrizzleExecutor,
  ): Promise<ScheduledJobRow | null> {
    // Refused at the call site rather than six hours later in a sweep nobody
    // is watching. A kind with no handler is a row that will only ever be
    // skipped, and the caller is the only one who can still fix it cheaply.
    if (!this.handlers.get(input.kind)) {
      throw this.errors.create(ErrorCode.SCHEDULER_HANDLER_NOT_REGISTERED, {
        message:
          `No handler registered for scheduled job kind "${input.kind}". ` +
          `Registered: ${this.handlers.registeredKinds().join(', ') || '(none)'}`,
      });
    }

    const link = await this.resolveOccurrence(input.occurrenceId);

    const rows = await this.jobs.insertJobs(
      [
        {
          kind: input.kind,
          runAt: input.runAt,
          dedupeKey: input.dedupeKey,
          maxAttempts: input.maxAttempts ?? this.config.maxAttempts,
          payload: input.payload ?? {},
          subjectType: input.subject?.type ?? null,
          subjectId: input.subject?.id ?? null,
          ...link,
        },
      ],
      executor,
    );
    // Empty means the dedupe key already existed — the caller is idempotent,
    // which is the point, so this is a success and not a conflict.
    return rows[0] ?? null;
  }

  /**
   * Stamp the event's CURRENT version onto a calendar-bound job.
   *
   * Read here rather than taken from the caller: a version the caller invented
   * would make the staleness check meaningless, since the job would either
   * never run or never be invalidated.
   */
  private async resolveOccurrence(occurrenceId: string | undefined): Promise<{
    eventId: string | null;
    occurrenceId: string | null;
    eventVersion: number | null;
  }> {
    if (!occurrenceId) {
      return { eventId: null, occurrenceId: null, eventVersion: null };
    }
    const occurrence = await this.calendar.findOccurrence(occurrenceId);
    if (!occurrence) {
      throw this.errors.create(ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND);
    }
    const event = await this.calendar.findLiveById(occurrence.eventId);
    if (!event) throw this.errors.create(ErrorCode.CALENDAR_EVENT_NOT_FOUND);
    return {
      eventId: event.id,
      occurrenceId: occurrence.id,
      eventVersion: event.version,
    };
  }

  /**
   * Un-schedule work by the key it was booked under.
   *
   * Returns false when there was nothing pending — already fired, already
   * cancelled, or never scheduled. Deliberately not an error: a caller
   * cancelling something that has already run is the normal race, not a bug.
   */
  cancel(dedupeKey: string, executor?: DrizzleExecutor): Promise<boolean> {
    return this.jobs.cancelByDedupeKey(dedupeKey, executor);
  }

  /**
   * Un-schedule every unfired job about one thing.
   *
   * Pass the caller's transaction: "the invoice was paid" and "its chasers are
   * cancelled" should commit together, or a rollback leaves the reminders live
   * for a payment that never landed.
   */
  cancelFor(
    subjectType: string,
    subjectId: string,
    executor?: DrizzleExecutor,
  ): Promise<number> {
    return this.jobs.cancelBySubject(subjectType, subjectId, executor);
  }

  /** Everything scheduled about one thing, fired or not. */
  jobsFor(
    subjectType: string,
    subjectId: string,
    limit = 100,
  ): Promise<ScheduledJobRow[]> {
    return this.jobs.listBySubject(subjectType, subjectId, limit);
  }

  findByDedupeKey(dedupeKey: string): Promise<ScheduledJobRow | null> {
    return this.jobs.findByDedupeKey(dedupeKey);
  }

  /**
   * The numbers worth alerting on.
   *
   * `overdue5m > 0` is the one that matters: it means the poller is not keeping
   * up, or is dead. Everything else is context for that.
   */
  async status(): Promise<SchedulerStatus> {
    const health = await this.jobs.health();
    const registeredKinds = this.handlers.registeredKinds();
    const pending = await this.jobs.pendingKinds();
    return {
      ...health,
      degraded: health.overdue5m >= this.config.overdueAlertThreshold,
      registeredKinds,
      // Pending work nothing will ever run. It does not show up in `dead` or
      // `overdue5m` on its own, so without this it accrues invisibly.
      orphanedKinds: pending.filter((p) => !registeredKinds.includes(p.kind)),
    };
  }

  listDead(limit: number): Promise<ScheduledJobRow[]> {
    return this.jobs.listDead(limit);
  }

  /** Put a dead-lettered job back with a fresh attempt budget. */
  async requeueDead(id: string): Promise<ScheduledJobRow> {
    const row = await this.jobs.requeueDead(id, new Date());
    if (!row) throw this.errors.create(ErrorCode.SCHEDULED_JOB_NOT_FOUND);
    this.logger.warn(`Scheduled job ${id} requeued from the dead-letter queue`);
    return row;
  }

  jobsForOccurrence(occurrenceId: string): Promise<ScheduledJobRow[]> {
    return this.jobs.listForOccurrence(occurrenceId);
  }

  runTick(): Promise<TickResult> {
    return this.dispatcher.tick();
  }

  runReap(): Promise<ReapResult> {
    return this.reaper.run();
  }

  async runMaterialize(): Promise<{
    events: number;
    occurrences: number;
    jobs: number;
  }> {
    const results = await this.materializer.run();
    return {
      events: results.length,
      occurrences: results.reduce((n, r) => n + r.occurrencesCreated, 0),
      jobs: results.reduce((n, r) => n + r.jobsCreated, 0),
    };
  }

  /** Registered into `RetentionPurgeRegistry` by the module. */
  purgeTerminalOlderThan(cutoff: Date, limit: number): Promise<number> {
    return this.jobs.purgeTerminalOlderThan(cutoff, limit);
  }
}
