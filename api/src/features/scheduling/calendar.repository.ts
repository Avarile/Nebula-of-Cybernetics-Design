import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  calendarEvents,
  eventOccurrences,
  type CalendarEventRow,
  type EventOccurrenceRow,
  type NewCalendarEventRow,
  type NewEventOccurrenceRow,
} from '../../infrastructure/database/schema/calendar.schema';

/** One page of a calendar range read. */
export interface OccurrenceWithEvent {
  occurrence: EventOccurrenceRow;
  event: CalendarEventRow;
}

/**
 * The rule table and the occurrence table.
 *
 * Split from {@link SchedulingRepository} so the poller's hot path never shares
 * a file — or a reviewer's attention — with user-facing calendar reads.
 *
 * Every write takes an optional {@link DrizzleExecutor}: an edit must bump the
 * version, delete future pending jobs and re-expand in ONE transaction, and a
 * repository that can only write through its own connection cannot participate
 * in the caller's.
 */
@Injectable()
export class CalendarRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // --- events ---

  async create(
    values: NewCalendarEventRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<CalendarEventRow> {
    const rows = await executor
      .insert(calendarEvents)
      .values(values)
      .returning();
    return rows[0];
  }

  async findById(id: string): Promise<CalendarEventRow | null> {
    const rows = await this.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Ignores soft-deleted rows. Use this for anything user-facing. */
  async findLiveById(id: string): Promise<CalendarEventRow | null> {
    const rows = await this.db
      .select()
      .from(calendarEvents)
      .where(
        and(eq(calendarEvents.id, id), eq(calendarEvents.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForOwner(
    ownerUserId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: CalendarEventRow[]; total: number }> {
    const where = and(
      eq(calendarEvents.ownerUserId, ownerUserId),
      eq(calendarEvents.isDeleted, false),
    );
    const rows = await this.db
      .select()
      .from(calendarEvents)
      .where(where)
      .orderBy(desc(calendarEvents.startLocal))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(calendarEvents)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Apply an edit and bump `version` in one statement.
   *
   * The bump is what invalidates already-scheduled work: every job created
   * against the previous version identifies itself as stale when it wakes up
   * and drops itself, so nothing has to be hunted down and cancelled.
   */
  async updateWithVersionBump(
    id: string,
    patch: Partial<NewCalendarEventRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<CalendarEventRow | null> {
    const rows = await executor
      .update(calendarEvents)
      .set({
        ...patch,
        version: sql`${calendarEvents.version} + 1`,
        // Any edit invalidates the expansion; the materializer redoes it.
        materializedThrough: null,
      })
      .where(
        and(eq(calendarEvents.id, id), eq(calendarEvents.isDeleted, false)),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Soft-delete. Occurrences and jobs cascade on a hard delete only, so the
   * caller must also cancel the future work — see `CalendarService.remove`. */
  async softDelete(
    id: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .update(calendarEvents)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(calendarEvents.id, id), eq(calendarEvents.isDeleted, false)),
      )
      .returning({ id: calendarEvents.id });
    return rows.length > 0;
  }

  /**
   * Live events whose expansion has not reached `horizonEnd`.
   *
   * Hits `calendar_event_materialize_idx`, which is partial on exactly this
   * predicate. `materialized_through IS NULL` covers both a new event and one
   * whose edit reset it.
   */
  dueForMaterialization(
    horizonEnd: Date,
    limit: number,
  ): Promise<CalendarEventRow[]> {
    return this.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.isDeleted, false),
          sql`${calendarEvents.status} <> 'cancelled'`,
          or(
            isNull(calendarEvents.materializedThrough),
            lt(calendarEvents.materializedThrough, horizonEnd),
          )!,
        ),
      )
      .orderBy(asc(calendarEvents.materializedThrough))
      .limit(limit);
  }

  async setMaterializedThrough(
    id: string,
    through: Date,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(calendarEvents)
      .set({ materializedThrough: through })
      .where(eq(calendarEvents.id, id));
  }

  // --- occurrences ---

  /**
   * Insert what is missing, leave what exists.
   *
   * `onConflictDoNothing` against `event_occurrence_identity_idx` is the whole
   * override mechanism: a moved instance keeps its `original_start`, so
   * re-expansion collides with it and does nothing. No flag is consulted, no
   * reconciliation pass runs, and the override survives every subsequent
   * materialization for free.
   */
  async upsertOccurrences(
    rows: NewEventOccurrenceRow[],
    executor: DrizzleExecutor = this.db,
  ): Promise<EventOccurrenceRow[]> {
    if (rows.length === 0) return [];
    return executor
      .insert(eventOccurrences)
      .values(rows)
      .onConflictDoNothing({
        target: [eventOccurrences.eventId, eventOccurrences.originalStart],
      })
      .returning();
  }

  async findOccurrence(id: string): Promise<EventOccurrenceRow | null> {
    const rows = await this.db
      .select()
      .from(eventOccurrences)
      .where(eq(eventOccurrences.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Occurrences overlapping a UTC window.
   *
   * The bounds MUST be derived from the viewer's zone at the API boundary — see
   * `calendar-window.ts`. Passing a naive `2025-09-01T00:00:00Z` silently drops
   * the first morning of the month for anyone east of UTC.
   */
  async listRange(
    ownerUserId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<OccurrenceWithEvent[]> {
    const rows = await this.db
      .select({ occurrence: eventOccurrences, event: calendarEvents })
      .from(eventOccurrences)
      .innerJoin(
        calendarEvents,
        eq(eventOccurrences.eventId, calendarEvents.id),
      )
      .where(
        and(
          eq(eventOccurrences.ownerUserId, ownerUserId),
          eq(calendarEvents.isDeleted, false),
          // Overlap, not containment: a meeting already in progress belongs on
          // the calendar you are looking at.
          lt(eventOccurrences.startsAt, to),
          sql`${eventOccurrences.endsAt} > ${from}`,
        ),
      )
      .orderBy(asc(eventOccurrences.startsAt))
      .limit(limit);
    return rows;
  }

  /**
   * Drop future instances that the rule owns, keeping user overrides.
   *
   * Called before a re-expansion. Overrides are excluded because deleting one
   * would discard a deliberate, user-visible decision in order to regenerate a
   * row the rule would have produced anyway.
   */
  async deleteFutureGeneratedOccurrences(
    eventId: string,
    from: Date,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .delete(eventOccurrences)
      .where(
        and(
          eq(eventOccurrences.eventId, eventId),
          gte(eventOccurrences.startsAt, from),
          eq(eventOccurrences.isOverride, false),
        ),
      )
      .returning({ id: eventOccurrences.id });
    return rows.length;
  }

  /** Move or retitle ONE instance. `original_start` is deliberately untouched. */
  async overrideOccurrence(
    id: string,
    patch: {
      startsAt?: Date;
      endsAt?: Date;
      startLocal?: string;
      endLocal?: string;
      titleOverride?: string | null;
      status?: EventOccurrenceRow['status'];
    },
    executor: DrizzleExecutor = this.db,
  ): Promise<EventOccurrenceRow | null> {
    const rows = await executor
      .update(eventOccurrences)
      .set({ ...patch, isOverride: true })
      .where(eq(eventOccurrences.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Cancelling the whole series: a status change, not a search-and-destroy. */
  async cancelFutureOccurrences(
    eventId: string,
    from: Date,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(eventOccurrences)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(eventOccurrences.eventId, eventId),
          gte(eventOccurrences.startsAt, from),
          eq(eventOccurrences.status, 'scheduled'),
        ),
      )
      .returning({ id: eventOccurrences.id });
    return rows.length;
  }

  /**
   * Future instances the user has moved or retitled.
   *
   * An edit deletes the event's future pending jobs, but re-expansion only
   * creates work for occurrences it INSERTS — and an override already exists,
   * so it collides and is skipped. Without this, editing a series silently
   * stripped the reminders off every instance the user had personalised, which
   * is both the least expected outcome and the hardest to notice.
   */
  futureOverrides(
    eventId: string,
    from: Date,
    executor: DrizzleExecutor = this.db,
  ): Promise<EventOccurrenceRow[]> {
    return executor
      .select()
      .from(eventOccurrences)
      .where(
        and(
          eq(eventOccurrences.eventId, eventId),
          eq(eventOccurrences.isOverride, true),
          eq(eventOccurrences.status, 'scheduled'),
          gte(eventOccurrences.startsAt, from),
        ),
      )
      .orderBy(asc(eventOccurrences.startsAt));
  }

  /** Occurrences of one event within a window, for job (re)scheduling. */
  occurrencesForEvent(
    eventId: string,
    from: Date,
    to: Date,
  ): Promise<EventOccurrenceRow[]> {
    return this.db
      .select()
      .from(eventOccurrences)
      .where(
        and(
          eq(eventOccurrences.eventId, eventId),
          gte(eventOccurrences.startsAt, from),
          lte(eventOccurrences.startsAt, to),
          eq(eventOccurrences.status, 'scheduled'),
        ),
      )
      .orderBy(asc(eventOccurrences.startsAt));
  }
}
