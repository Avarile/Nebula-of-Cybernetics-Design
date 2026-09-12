import { Inject, Injectable, Logger } from '@nestjs/common';
import { isAdmin, requireUserId, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import type {
  CalendarEventRow,
  EventOccurrenceRow,
} from '../../infrastructure/database/schema/calendar.schema';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ProfileService } from '../users/profile.service';
import { CalendarRepository } from './calendar.repository';
import { localWindowToUtc } from './calendar-window';
import type {
  CreateEventDto,
  ListEventsDto,
  ListRangeDto,
  MoveOccurrenceDto,
  UpdateEventDto,
} from './dto/calendar.dto';
import { MaterializerService } from './materializer.service';
import { SchedulingRepository } from './scheduling.repository';
import {
  addWallClockMinutes,
  asUtcMs,
  formatWallClock,
  fromWallClock,
  parseWallClock,
} from './timezone';

export interface PublicOccurrence {
  id: string;
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  startLocal: string;
  endLocal: string;
  timezone: string;
  status: EventOccurrenceRow['status'];
  isOverride: boolean;
  location: string | null;
  projectId: string | null;
}

/**
 * Calendar events and their instances.
 *
 * Every write that touches a rule runs in ONE transaction: bump the version,
 * delete the future work created against the old one, re-expand. That ordering
 * is what makes editing free — jobs already `claimed` are mid-flight and fail
 * their own version check in the dispatcher, so nothing has to coordinate with
 * a running worker.
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly calendar: CalendarRepository,
    private readonly jobs: SchedulingRepository,
    private readonly materializer: MaterializerService,
    private readonly profiles: ProfileService,
    private readonly errors: ExceptionService,
  ) {}

  async create(
    dto: CreateEventDto,
    principal: Principal,
  ): Promise<CalendarEventRow> {
    const ownerUserId = requireUserId(principal);
    this.assertRuleIsCoherent(dto);
    const now = new Date();

    const created = await this.db.transaction(async (tx) => {
      const row = await this.calendar.create(
        {
          ownerUserId,
          title: dto.title,
          description: dto.description ?? null,
          location: dto.location ?? null,
          status: dto.status,
          allDay: dto.allDay,
          timezone: dto.timezone,
          startLocal: normalizeWallClock(dto.startLocal),
          durationMinutes: dto.durationMinutes,
          frequency: dto.frequency,
          recurrenceInterval: dto.interval,
          byWeekday: dto.byWeekday,
          recurrenceCount: dto.count ?? null,
          recurrenceUntilLocal: dto.untilLocal
            ? normalizeWallClock(dto.untilLocal)
            : null,
          reminderOffsetsMs: dto.reminderOffsetsMs,
          projectId: dto.projectId ?? null,
        },
        tx,
      );
      // Inline, in the same transaction: an event that is briefly present but
      // unexpanded is an event whose first reminder silently never fires.
      await this.materializer.materializeEvent(
        row,
        now,
        this.materializer.horizonEnd(now),
        tx,
      );
      return row;
    });

    return (await this.calendar.findById(created.id))!;
  }

  async get(id: string, principal: Principal): Promise<CalendarEventRow> {
    return this.load(id, principal);
  }

  async list(
    query: ListEventsDto,
    principal: Principal,
  ): Promise<{ rows: CalendarEventRow[]; total: number }> {
    const ownerUserId = requireUserId(principal);
    return this.calendar.listForOwner(ownerUserId, query.page, query.limit);
  }

  /**
   * Edit the rule.
   *
   * The version bump invalidates every future job in one statement; there is no
   * search-and-destroy, and no reconciliation between what was scheduled and
   * what the event now says.
   */
  async update(
    id: string,
    dto: UpdateEventDto,
    principal: Principal,
  ): Promise<CalendarEventRow> {
    const existing = await this.load(id, principal);
    this.assertRuleIsCoherent({ ...toRuleShape(existing), ...dto });
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const row = await this.calendar.updateWithVersionBump(
        id,
        {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && {
            description: dto.description ?? null,
          }),
          ...(dto.location !== undefined && { location: dto.location ?? null }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.allDay !== undefined && { allDay: dto.allDay }),
          ...(dto.timezone !== undefined && { timezone: dto.timezone }),
          ...(dto.startLocal !== undefined && {
            startLocal: normalizeWallClock(dto.startLocal),
          }),
          ...(dto.durationMinutes !== undefined && {
            durationMinutes: dto.durationMinutes,
          }),
          ...(dto.frequency !== undefined && { frequency: dto.frequency }),
          ...(dto.interval !== undefined && {
            recurrenceInterval: dto.interval,
          }),
          ...(dto.byWeekday !== undefined && { byWeekday: dto.byWeekday }),
          ...(dto.count !== undefined && {
            recurrenceCount: dto.count ?? null,
          }),
          ...(dto.untilLocal !== undefined && {
            recurrenceUntilLocal: dto.untilLocal
              ? normalizeWallClock(dto.untilLocal)
              : null,
          }),
          ...(dto.reminderOffsetsMs !== undefined && {
            reminderOffsetsMs: dto.reminderOffsetsMs,
          }),
          ...(dto.projectId !== undefined && {
            projectId: dto.projectId ?? null,
          }),
        },
        tx,
      );
      if (!row) throw this.errors.create(ErrorCode.CALENDAR_EVENT_NOT_FOUND);

      // Only `pending` rows are removed here. A `claimed` job is running in
      // another process and is left alone: it either fails its own version
      // check, or its row cascades away with the occurrence below. Either way
      // it does not fire, and neither path has to coordinate with the worker.
      await this.jobs.deleteFuturePending(id, now, tx);
      // Overrides survive: deleting one would discard a decision the user made
      // in order to regenerate a row the rule would have produced anyway.
      await this.calendar.deleteFutureGeneratedOccurrences(id, now, tx);
      await this.materializer.materializeEvent(
        row,
        now,
        this.materializer.horizonEnd(now),
        tx,
      );
      // Overrides survived the delete above, so re-expansion collided with them
      // and created no work — leaving them with the reminders just deleted and
      // no replacement. Reschedule them explicitly, at the new version.
      for (const override of await this.calendar.futureOverrides(id, now, tx)) {
        await this.materializer.rescheduleOccurrence(
          row,
          override.id,
          override.startsAt,
          now,
          tx,
        );
      }
    });

    return (await this.calendar.findById(id))!;
  }

  /** Cancelling is a status change, not a search-and-destroy. */
  async cancel(id: string, principal: Principal): Promise<CalendarEventRow> {
    await this.load(id, principal);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await this.calendar.updateWithVersionBump(
        id,
        { status: 'cancelled' },
        tx,
      );
      await this.calendar.cancelFutureOccurrences(id, now, tx);
      await this.jobs.deleteFuturePending(id, now, tx);
    });
    return (await this.calendar.findById(id))!;
  }

  async remove(id: string, principal: Principal): Promise<void> {
    await this.load(id, principal);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await this.calendar.softDelete(id, tx);
      await this.calendar.cancelFutureOccurrences(id, now, tx);
      await this.jobs.deleteFuturePending(id, now, tx);
    });
  }

  /**
   * The calendar read.
   *
   * The window arrives as LOCAL dates and is converted here, once, using the
   * viewer's zone. Everything below this line works in instants.
   */
  async listRange(
    query: ListRangeDto,
    principal: Principal,
  ): Promise<PublicOccurrence[]> {
    const ownerUserId = requireUserId(principal);
    const timezone =
      query.timezone ?? (await this.profiles.get(ownerUserId)).timezone;
    let window;
    try {
      window = localWindowToUtc(query.from, query.to, timezone);
    } catch (error) {
      throw this.errors.create(ErrorCode.VALIDATION_FAILED, {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const rows = await this.calendar.listRange(
      ownerUserId,
      window.from,
      window.to,
      query.limit,
    );
    return rows
      .filter(({ event }) => event.status !== 'cancelled')
      .map(({ occurrence, event }) => ({
        id: occurrence.id,
        eventId: event.id,
        title: occurrence.titleOverride ?? event.title,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        startLocal: occurrence.startLocal,
        endLocal: occurrence.endLocal,
        timezone: occurrence.timezone,
        status: occurrence.status,
        isOverride: occurrence.isOverride,
        location: event.location,
        projectId: event.projectId,
      }));
  }

  /**
   * Move or retitle ONE instance.
   *
   * `original_start` is untouched, which is the entire trick: the next
   * expansion collides with it, does nothing, and the override survives without
   * anything having to remember that it exists.
   */
  async moveOccurrence(
    occurrenceId: string,
    dto: MoveOccurrenceDto,
    principal: Principal,
  ): Promise<EventOccurrenceRow> {
    const occurrence = await this.calendar.findOccurrence(occurrenceId);
    if (!occurrence) {
      throw this.errors.create(ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND);
    }
    const event = await this.load(occurrence.eventId, principal);

    const startLocal = dto.startLocal
      ? parseWallClock(normalizeWallClock(dto.startLocal))
      : parseWallClock(occurrence.startLocal);
    const durationMinutes =
      dto.durationMinutes ??
      Math.round(
        (asUtcMs(parseWallClock(occurrence.endLocal)) -
          asUtcMs(parseWallClock(occurrence.startLocal))) /
          60_000,
      );
    const endLocal = addWallClockMinutes(startLocal, durationMinutes);
    const startsAt = fromWallClock(startLocal, occurrence.timezone);
    const now = new Date();

    const moved = await this.db.transaction(async (tx) => {
      const row = await this.calendar.overrideOccurrence(
        occurrenceId,
        {
          startsAt,
          endsAt: fromWallClock(endLocal, occurrence.timezone),
          startLocal: formatWallClock(startLocal),
          endLocal: formatWallClock(endLocal),
          ...(dto.title !== undefined && { titleOverride: dto.title ?? null }),
        },
        tx,
      );
      if (!row) {
        throw this.errors.create(ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND);
      }
      // The occurrence row already existed, so `materializeEvent` would leave
      // it — and its reminders — exactly where they were.
      await this.materializer.rescheduleOccurrence(
        event,
        occurrenceId,
        startsAt,
        now,
        tx,
      );
      return row;
    });
    return moved;
  }

  /** Cancel one instance without touching the series. */
  async cancelOccurrence(
    occurrenceId: string,
    principal: Principal,
  ): Promise<EventOccurrenceRow> {
    const occurrence = await this.calendar.findOccurrence(occurrenceId);
    if (!occurrence) {
      throw this.errors.create(ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND);
    }
    await this.load(occurrence.eventId, principal);
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const row = await this.calendar.overrideOccurrence(
        occurrenceId,
        { status: 'cancelled' },
        tx,
      );
      await this.jobs.deleteFuturePendingForOccurrence(occurrenceId, now, tx);
      return row!;
    });
  }

  /**
   * Load an event the caller may see.
   *
   * An event belonging to someone else answers 404, not 403: 403 would confirm
   * that the id exists, which is a disclosure the caller has no business
   * receiving from a personal calendar.
   */
  private async load(
    id: string,
    principal: Principal,
  ): Promise<CalendarEventRow> {
    const row = await this.calendar.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.CALENDAR_EVENT_NOT_FOUND);
    if (!isAdmin(principal) && row.ownerUserId !== requireUserId(principal)) {
      throw this.errors.create(ErrorCode.CALENDAR_EVENT_NOT_FOUND);
    }
    return row;
  }

  /**
   * Reject rules that would expand to nothing, or to something the author did
   * not mean. Structural validation is the DTO's job; this is the semantic
   * half, which needs the merged before-and-after picture on an edit.
   */
  private assertRuleIsCoherent(rule: {
    frequency: CalendarEventRow['frequency'];
    startLocal: string;
    untilLocal?: string | null;
    count?: number | null;
    byWeekday?: number[];
  }): void {
    const fail = (message: string): never => {
      throw this.errors.create(ErrorCode.CALENDAR_RULE_INVALID, { message });
    };

    if (rule.frequency === 'none') {
      if (rule.count != null || rule.untilLocal != null) {
        fail('A non-recurring event cannot carry a count or an end date');
      }
      if (rule.byWeekday && rule.byWeekday.length > 0) {
        fail('byWeekday applies to weekly recurrence only');
      }
      return;
    }
    if (rule.count != null && rule.untilLocal != null) {
      // Both are ends of the series and they will disagree; RFC 5545 forbids
      // sending both for the same reason.
      fail('Specify either a count or an end date, not both');
    }
    if (
      rule.byWeekday &&
      rule.byWeekday.length > 0 &&
      rule.frequency !== 'weekly'
    ) {
      fail('byWeekday applies to weekly recurrence only');
    }
    if (rule.untilLocal != null) {
      const start = asUtcMs(
        parseWallClock(normalizeWallClock(rule.startLocal)),
      );
      const until = asUtcMs(
        parseWallClock(normalizeWallClock(rule.untilLocal)),
      );
      if (until < start) fail('The series cannot end before it starts');
    }
  }
}

/** A bare `YYYY-MM-DD` means midnight local — the same rule as the range API. */
function normalizeWallClock(value: string): string {
  const trimmed = value.trim();
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed} 00:00:00`
    : trimmed;
  return formatWallClock(parseWallClock(withTime));
}

/** The rule fields of a stored event, in the shape the validator expects. */
function toRuleShape(event: CalendarEventRow): {
  frequency: CalendarEventRow['frequency'];
  startLocal: string;
  untilLocal: string | null;
  count: number | null;
  byWeekday: number[];
} {
  return {
    frequency: event.frequency,
    startLocal: event.startLocal,
    untilLocal: event.recurrenceUntilLocal,
    count: event.recurrenceCount,
    byWeekday: event.byWeekday,
  };
}
