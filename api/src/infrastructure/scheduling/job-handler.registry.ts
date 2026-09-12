import { Injectable, Logger } from '@nestjs/common';
import type {
  CalendarEventRow,
  EventOccurrenceRow,
  ScheduledJobRow,
} from '../database/schema/calendar.schema';

/**
 * Everything a handler needs, re-read from the source of truth at run time.
 *
 * `calendar` is one object rather than two nullable fields so that "an event
 * but no occurrence" is unrepresentable — the same reason `Principal` is a
 * discriminated union rather than `{ id: string | null }`. One check narrows
 * both:
 *
 *   if (!ctx.calendar) return this.handleStandalone(ctx.job);
 *   const { event, occurrence } = ctx.calendar;
 */
export interface ScheduledJobContext {
  job: ScheduledJobRow;
  /**
   * The rule and instance this job was scheduled against, re-read at execution
   * time and already checked for staleness by the dispatcher.
   *
   * Null for a standalone job — one another module scheduled with no calendar
   * occurrence behind it. Such a job has no version to be stale against, so its
   * handler is responsible for deciding whether the work is still wanted;
   * `job.subjectType` / `job.subjectId` say what to go and look at.
   */
  calendar: {
    event: CalendarEventRow;
    occurrence: EventOccurrenceRow;
  } | null;
}

/**
 * What actually happens when a job fires.
 *
 * Delivery is **at-least-once**. A crash between "sent the email" and "marked
 * done" is unavoidable, so a handler WILL run twice eventually. Do not try to
 * fix that here — enforce exactly-once at the side effect instead, with a
 * unique key that turns the second write into a no-op. `EventReminderHandler`
 * does it with `notifications.dedupe_key`.
 */
export type ScheduledJobHandler = (
  context: ScheduledJobContext,
) => Promise<void>;

/**
 * The key a handler registers under, matching `scheduled_job.kind`.
 *
 * A plain string, not a union: the point of the registry is that a module can
 * add a kind without this file — or the poller — knowing about it. Namespace
 * it like an event key (`invoice.chase`, `mailbox.resync`) so two modules
 * cannot collide by accident.
 */
export type JobKind = string;

/**
 * Where modules declare how their own scheduled work is executed.
 *
 * Lives in infrastructure rather than in the scheduling feature for the same
 * reason `RetentionPurgeRegistry` does: both sides need it, and making it the
 * feature's property would force the dispatcher to import every module whose
 * work it runs — an infrastructure concern depending on all its consumers,
 * which is exactly backwards. Each module registers at bootstrap:
 *
 *   registry.register('event_reminder', (ctx) => this.reminders.handle(ctx));
 *
 * A job whose kind has no registered handler is **skipped and logged**, never
 * treated as done. Silence there would let jobs pile up looking successful.
 * `SchedulingService.schedule` additionally refuses to CREATE one, so the
 * common case — a typo, or a module that forgot to register — fails at the
 * call site instead of six hours later in a sweep nobody is watching.
 */
@Injectable()
export class ScheduledJobHandlerRegistry {
  private readonly logger = new Logger(ScheduledJobHandlerRegistry.name);
  private readonly handlers = new Map<JobKind, ScheduledJobHandler>();

  register(kind: JobKind, handler: ScheduledJobHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`Scheduled job handler for "${kind}" already registered`);
    }
    this.handlers.set(kind, handler);
    this.logger.debug(`Registered scheduled job handler for "${kind}"`);
  }

  get(kind: JobKind): ScheduledJobHandler | undefined {
    return this.handlers.get(kind);
  }

  registeredKinds(): JobKind[] {
    return [...this.handlers.keys()].sort();
  }
}
