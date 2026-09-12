import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SchedulingConfig } from '../../config/configurations/scheduling.config';
import type { DrizzleExecutor } from '../../infrastructure/database/drizzle.constants';
import {
  CALENDAR_JOB_KINDS,
  type CalendarEventRow,
  type NewEventOccurrenceRow,
  type NewScheduledJobRow,
} from '../../infrastructure/database/schema/calendar.schema';
import { CalendarRepository } from './calendar.repository';
import { expandSeries, type SeriesDefinition } from './recurrence';
import { reminderDedupeKey } from './scheduling.constants';
import { SchedulingRepository } from './scheduling.repository';
import { formatWallClock, parseWallClock } from './timezone';

export interface MaterializeResult {
  eventId: string;
  occurrencesCreated: number;
  jobsCreated: number;
}

const DAY_MS = 86_400_000;

/** `subject_type` for anything scheduled against a calendar event. */
export const CALENDAR_EVENT_SUBJECT = 'calendar_event';

/**
 * Expands rules into occurrences, and occurrences into scheduled work.
 *
 * Runs nightly for everything, and inline (inside the caller's transaction) for
 * one event whenever it is created or edited — so a new event is never briefly
 * present but unexpanded.
 *
 * The horizon is the knob that bounds storage. Ninety days of occurrences for a
 * daily event is ninety rows; an unbounded expansion of an open-ended series is
 * a table that grows until someone notices.
 */
@Injectable()
export class MaterializerService {
  private readonly logger = new Logger(MaterializerService.name);
  private readonly config: SchedulingConfig;

  constructor(
    private readonly calendar: CalendarRepository,
    private readonly jobs: SchedulingRepository,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<SchedulingConfig>('scheduling');
  }

  /** The end of the expansion window, from a given moment. */
  horizonEnd(from: Date = new Date()): Date {
    return new Date(
      from.getTime() + this.config.materializeHorizonDays * DAY_MS,
    );
  }

  /**
   * Nightly pass. Bounded by `materializeBatch` so one run cannot stall on a
   * backlog; the next run picks up where this one stopped, because
   * `materialized_through` is what selects the work.
   */
  async run(now: Date = new Date()): Promise<MaterializeResult[]> {
    const horizon = this.horizonEnd(now);
    const due = await this.calendar.dueForMaterialization(
      horizon,
      this.config.materializeBatch,
    );
    const results: MaterializeResult[] = [];
    for (const event of due) {
      // Sequential on purpose: this is background work sharing a pool with the
      // request path, and there is nothing to gain from finishing it sooner.
      results.push(await this.materializeEvent(event, now, horizon));
    }
    const occurrences = results.reduce((n, r) => n + r.occurrencesCreated, 0);
    const created = results.reduce((n, r) => n + r.jobsCreated, 0);
    if (due.length > 0) {
      this.logger.log(
        `Materialized ${due.length} event(s): +${occurrences} occurrence(s), ` +
          `+${created} job(s) through ${horizon.toISOString()}`,
      );
    }
    return results;
  }

  /**
   * Expand one event and schedule the work its new occurrences imply.
   *
   * Both writes are idempotent — occurrences collide on `(event_id,
   * original_start)`, jobs on `dedupe_key` — so re-running this over a window
   * that has already been expanded inserts nothing and costs two statements.
   * That is what makes it safe to call from the nightly sweep, from an edit,
   * and from a retry of either.
   */
  async materializeEvent(
    event: CalendarEventRow,
    from: Date,
    to: Date,
    executor?: DrizzleExecutor,
  ): Promise<MaterializeResult> {
    const expanded = expandSeries(seriesOf(event), { from, to });

    const occurrenceRows: NewEventOccurrenceRow[] = expanded.map((o) => ({
      eventId: event.id,
      ownerUserId: event.ownerUserId,
      originalStart: o.originalStart,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      startLocal: formatWallClock(o.startLocal),
      endLocal: formatWallClock(o.endLocal),
      timezone: event.timezone,
    }));

    // Only rows that did NOT already exist come back, so an override — which
    // collides and is left alone — never has its jobs rewritten here.
    const created = await this.calendar.upsertOccurrences(
      occurrenceRows,
      executor,
    );

    const jobRows: NewScheduledJobRow[] = [];
    for (const occurrence of created) {
      jobRows.push(
        ...remindersFor(event, occurrence.id, occurrence.startsAt, from),
      );
    }
    const jobs = await this.jobs.insertJobs(jobRows, executor);

    await this.calendar.setMaterializedThrough(event.id, to, executor);
    return {
      eventId: event.id,
      occurrencesCreated: created.length,
      jobsCreated: jobs.length,
    };
  }

  /**
   * Re-schedule the reminders for one occurrence, at the current version.
   *
   * Used when a single instance is moved: its occurrence row already exists, so
   * `materializeEvent` would skip it, but its reminders now fire at the wrong
   * time. The old jobs are deleted rather than left to go stale, because they
   * carry the same event version and would otherwise still fire.
   */
  async rescheduleOccurrence(
    event: CalendarEventRow,
    occurrenceId: string,
    startsAt: Date,
    now: Date,
    executor?: DrizzleExecutor,
  ): Promise<number> {
    await this.jobs.deleteFuturePendingForOccurrence(
      occurrenceId,
      now,
      executor,
    );
    const rows = remindersFor(event, occurrenceId, startsAt, now);
    const jobs = await this.jobs.insertJobs(rows, executor);
    return jobs.length;
  }
}

/** Read the rule off the row, in the form the pure expander expects. */
export function seriesOf(event: CalendarEventRow): SeriesDefinition {
  return {
    startLocal: parseWallClock(event.startLocal),
    durationMinutes: event.durationMinutes,
    timeZone: event.timezone,
    rule: {
      frequency: event.frequency,
      interval: event.recurrenceInterval,
      byWeekday: event.byWeekday,
      count: event.recurrenceCount,
      untilLocal: event.recurrenceUntilLocal
        ? parseWallClock(event.recurrenceUntilLocal)
        : null,
    },
  };
}

/**
 * The reminder jobs one occurrence implies.
 *
 * A lead time that has already elapsed produces NO job. A "15 minutes before"
 * reminder for a meeting starting in five is not a reminder, and creating it
 * would fire immediately and, worse, show up in `overdue_5m` — the one number
 * that must mean "the poller is behind" and nothing else.
 */
export function remindersFor(
  event: CalendarEventRow,
  occurrenceId: string,
  startsAt: Date,
  notBefore: Date,
): NewScheduledJobRow[] {
  const rows: NewScheduledJobRow[] = [];
  for (const offsetMs of new Set(event.reminderOffsetsMs)) {
    if (!Number.isFinite(offsetMs) || offsetMs < 0) continue;
    const runAt = new Date(startsAt.getTime() - offsetMs);
    if (runAt.getTime() < notBefore.getTime()) continue;
    rows.push({
      kind: CALENDAR_JOB_KINDS.reminder,
      eventId: event.id,
      occurrenceId,
      eventVersion: event.version,
      runAt,
      dedupeKey: reminderDedupeKey(occurrenceId, offsetMs),
      payload: { offsetMs },
      // Set even though `event_id` already says it, so that "what is scheduled
      // for X?" is one query shape for every module rather than a special case
      // the calendar is exempt from.
      subjectType: CALENDAR_EVENT_SUBJECT,
      subjectId: event.id,
    });
  }
  return rows;
}
