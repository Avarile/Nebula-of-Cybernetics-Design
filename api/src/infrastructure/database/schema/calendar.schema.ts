import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { users } from './identity.schema';
import { projects } from './project.schema';

/**
 * Calendar + scheduling.
 *
 * Three tables, each answering one question:
 *
 *   `calendar_event`   — what is the rule?          (user edits)
 *   `event_occurrence` — what is on my calendar?    (calendar reads)
 *   `scheduled_job`    — what must fire, and when?  (the poller)
 *
 * The load-bearing idea is that **a job row is a reminder that something might
 * need doing, not the instruction**. Truth is re-read from `calendar_event` at
 * execution time, which is what makes editing an event free: bump `version` and
 * every job created against the old version identifies itself as stale when it
 * wakes up. A queue message cannot do this, because it carries a copy of the
 * intent and there is no cheap way to invalidate a copy.
 */

/** Mirrors iCalendar STATUS. `cancelled` is a state, not a deletion. */
export const calendarEventStatus = pgEnum('calendar_event_status', [
  'confirmed',
  'tentative',
  'cancelled',
]);

/**
 * The subset of RFC 5545 FREQ this expander implements.
 *
 * Named `calendar_*` because `finance.schema.ts` already owns a
 * `recurrence_frequency` type with a different set of values — two pgEnums
 * cannot share a Postgres type name, and the collision would only surface at
 * migration time.
 */
export const calendarRecurrenceFrequency = pgEnum(
  'calendar_recurrence_frequency',
  ['none', 'daily', 'weekly', 'monthly', 'yearly'],
);

export const eventOccurrenceStatus = pgEnum('event_occurrence_status', [
  'scheduled',
  'cancelled',
]);

/**
 * Job lifecycle.
 *
 *  - `pending`  — due (or will be); the only status the poller's index holds.
 *  - `claimed`  — leased by a worker. A lease that stops ticking is reaped.
 *  - `done`     — the handler ran.
 *  - `skipped`  — deliberately not run: stale version, cancelled, no handler.
 *    Distinct from `failed` on purpose; conflating them hides real failures.
 *  - `failed`   — the handler threw and retries remain (back to `pending`).
 *  - `dead`     — retries exhausted. Needs eyes.
 */
export const scheduledJobStatus = pgEnum('scheduled_job_status', [
  'pending',
  'claimed',
  'done',
  'skipped',
  'failed',
  'dead',
]);

/**
 * Kinds this module ships. Deliberately NOT a Postgres enum.
 *
 * `kind` is the key a handler registers under, and the set of handlers is open
 * by design — any module can register one without `SchedulingModule` knowing.
 * An enum would make every new kind an `ALTER TYPE`, which is a migration to
 * add a line of code, so the vocabulary would harden around whatever the
 * calendar happened to need first.
 *
 * The check that would otherwise be the enum's job happens at write time
 * instead: `SchedulingService.schedule` refuses a kind with no registered
 * handler, so a typo fails at the call site rather than becoming a row nothing
 * will ever run.
 */
export const CALENDAR_JOB_KINDS = {
  reminder: 'event_reminder',
  start: 'event_start',
  end: 'event_end',
} as const;

/**
 * The rule. One row per event, recurring or not.
 *
 * **Wall clock is authoritative; the UTC instant is derived.** `start_local` is
 * a `timestamp without time zone` read and written as a STRING (`mode:
 * 'string'`), never as a `Date` — a naive timestamp parsed into a `Date` picks
 * up the server's zone, which is precisely the bug this column exists to avoid.
 * Expansion happens in floating time and converts through `timezone` at the
 * end, so a 09:00 standup stays at 09:00 across a DST boundary instead of
 * drifting an hour.
 *
 * `version` is the staleness token. Every edit bumps it inside the same
 * transaction that deletes future pending jobs and re-expands; jobs already
 * `claimed` are mid-flight and fail their own version check in the dispatcher.
 */
export const calendarEvents = pgTable(
  'calendar_event',
  {
    ...baseColumns,
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    description: varchar('description', { length: 2000 }),
    location: varchar('location', { length: 300 }),
    status: calendarEventStatus('status').notNull().default('confirmed'),
    allDay: boolean('all_day').notNull().default(false),
    /** IANA zone, e.g. `Australia/Melbourne`. Validated at the API boundary. */
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    /** Floating wall clock, `YYYY-MM-DD HH:MM:SS`. See the note above. */
    startLocal: timestamp('start_local', { mode: 'string' }).notNull(),
    /**
     * Duration in WALL-CLOCK minutes, not an end instant.
     *
     * A 09:00–10:00 meeting that spans a spring-forward is still 09:00–10:00
     * locally; storing an end instant would make it 09:00–11:00 or 09:00–09:00
     * depending on which side of the transition it was written on.
     */
    durationMinutes: integer('duration_minutes').notNull().default(0),

    // --- recurrence rule ---
    frequency: calendarRecurrenceFrequency('frequency')
      .notNull()
      .default('none'),
    recurrenceInterval: integer('recurrence_interval').notNull().default(1),
    /** WEEKLY only. `0 = Sunday` … `6 = Saturday`, matching `Date.getUTCDay`. */
    byWeekday: jsonb('by_weekday').$type<number[]>().notNull().default([]),
    /** Total occurrences in the series, counted from its first. Null = open. */
    recurrenceCount: integer('recurrence_count'),
    /** Inclusive end of the series, in wall clock — same reasoning as above. */
    recurrenceUntilLocal: timestamp('recurrence_until_local', {
      mode: 'string',
    }),

    /**
     * Reminder lead times, in ms before the occurrence start. `[900000]` fires
     * one reminder fifteen minutes before.
     *
     * A column rather than a table because the schema is single-owner. Per-
     * attendee reminder preferences would turn this into its own table; that is
     * much cheaper to design in before guest lists exist than after.
     */
    reminderOffsetsMs: jsonb('reminder_offsets_ms')
      .$type<number[]>()
      .notNull()
      .default([]),

    /** Bumped by every edit. The staleness token every job carries a copy of. */
    version: integer('version').notNull().default(1),
    /** Denormalized scope key, as in `activity_log`. */
    projectId: uuid('project_id').references(() => projects.id),
    /**
     * How far the expansion has run. Lets the nightly materializer touch only
     * the events whose horizon has actually moved.
     */
    materializedThrough: timestamp('materialized_through', {
      withTimezone: true,
    }),
  },
  (t) => [
    index('calendar_event_owner_idx').on(t.ownerUserId, t.startLocal),
    /** The materializer's exact predicate, partial so it holds only live rules. */
    index('calendar_event_materialize_idx')
      .on(t.materializedThrough)
      .where(sql`${t.isDeleted} = false AND ${t.status} <> 'cancelled'`),
    index('calendar_event_project_idx').on(t.projectId),
  ],
);

/**
 * What is on the calendar. One row per instance, expanded ahead of time.
 *
 * Append-only in spirit — no `baseColumns`, because a soft-deletable occurrence
 * is a second way to say `cancelled` and the two would inevitably disagree.
 *
 * `original_start` is the instance's permanent identity (iCalendar's
 * `RECURRENCE-ID`) and is **never rewritten**, including when the instance is
 * moved. Re-expansion therefore collides with `(event_id, original_start)` and
 * does nothing, so a single-instance override survives every subsequent
 * materialization for free — no reconciliation pass, no "is this one special?"
 * flag consulted at expansion time.
 */
export const eventOccurrences = pgTable(
  'event_occurrence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    /**
     * Denormalized from the event so a calendar range query is one index scan.
     * Without it every "my week" read joins the rule table.
     */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** RECURRENCE-ID. Immutable identity, even after a move. */
    originalStart: timestamp('original_start', {
      withTimezone: true,
    }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Kept alongside the instants so a client can render without a zone table. */
    startLocal: timestamp('start_local', { mode: 'string' }).notNull(),
    endLocal: timestamp('end_local', { mode: 'string' }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    status: eventOccurrenceStatus('status').notNull().default('scheduled'),
    /**
     * Set when a user moved or edited this instance alone. Re-expansion must
     * never overwrite an override, which the unique index below enforces
     * structurally rather than by a check in the materializer.
     */
    isOverride: boolean('is_override').notNull().default(false),
    titleOverride: varchar('title_override', { length: 300 }),
  },
  (t) => [
    /** Idempotent materialization, and the guard that protects overrides. */
    uniqueIndex('event_occurrence_identity_idx').on(t.eventId, t.originalStart),
    /** The calendar read: "my occurrences between two instants". */
    index('event_occurrence_owner_idx').on(t.ownerUserId, t.startsAt),
    index('event_occurrence_event_idx').on(t.eventId, t.startsAt),
  ],
);

/**
 * What must fire, and when. The poller's hot table.
 *
 * Deliberately narrow. The one index that matters is partial on `status`, so it
 * contains only unfired work — a few thousand rows — while the table itself
 * grows forever:
 *
 *   CREATE INDEX scheduled_job_due_idx ON scheduled_job (run_at)
 *     WHERE status = 'pending';
 *
 * The poller's cost stays flat as history accumulates. Drop the `WHERE` and you
 * have signed up for a scan that degrades every month you stay in business.
 *
 * `attempts` is incremented **at claim time**, not at failure time. A handler
 * that segfaults the worker still burns an attempt and dead-letters after
 * `max_attempts`; increment on failure — the intuitive choice — and a poison
 * job retries forever, taking the process with it each time.
 */
export const scheduledJobs = pgTable(
  'scheduled_job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    kind: varchar('kind', { length: 120 }).notNull(),
    /**
     * Calendar linkage — NULLABLE, because the poller is not the calendar's.
     *
     * A job bound to an occurrence opts into the staleness check: it carries
     * the `calendar_event.version` it was scheduled against, and the dispatcher
     * re-reads the event before running it. A standalone job scheduled by
     * another module ("chase this invoice on Friday") has no rule to be stale
     * against, so its handler owns its own validity check — which is the same
     * discipline, just enforced by whoever knows what validity means.
     */
    eventId: uuid('event_id').references(() => calendarEvents.id, {
      onDelete: 'cascade',
    }),
    occurrenceId: uuid('occurrence_id').references(() => eventOccurrences.id, {
      onDelete: 'cascade',
    }),
    /** Set iff `occurrence_id` is. See the note above. */
    eventVersion: integer('event_version'),
    /**
     * What the job is ABOUT, for any module: `('invoice', <id>)`,
     * `('calendar_event', <id>)`. Deliberately no foreign key — this table must
     * be able to point at rows in modules it does not import, the same
     * reasoning `activity_log.entity_id` and `agent_action_log.conversation_id`
     * already carry.
     *
     * It is what makes "drop the reminders for this invoice, it just got paid"
     * one statement instead of a search.
     */
    subjectType: varchar('subject_type', { length: 60 }),
    subjectId: uuid('subject_id'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    status: scheduledJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    /** When the current claim expires. The reaper's input. */
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /** Which process holds the lease — decisive when one replica misbehaves. */
    claimedBy: varchar('claimed_by', { length: 120 }),
    lastError: varchar('last_error', { length: 1000 }),
    /**
     * Idempotent materialization: `event_reminder:{occurrenceId}:{offsetMs}`.
     * Re-expanding an unchanged event inserts nothing.
     */
    dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
    /** Kind-specific detail, e.g. `{ offsetMs }` for a reminder. */
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    /** THE index. Partial, so it holds unfired work only. */
    index('scheduled_job_due_idx')
      .on(t.runAt)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex('scheduled_job_dedupe_idx').on(t.dedupeKey),
    /** The reaper's predicate — expired leases only, never the whole table. */
    index('scheduled_job_lease_idx')
      .on(t.leaseExpiresAt)
      .where(sql`${t.status} = 'claimed'`),
    /** "Delete this event's future pending work" during a re-expansion. */
    index('scheduled_job_event_idx').on(t.eventId, t.runAt),
    index('scheduled_job_occurrence_idx').on(t.occurrenceId),
    /** "What is scheduled for this thing?", for any module's thing. */
    index('scheduled_job_subject_idx').on(t.subjectType, t.subjectId),
    index('scheduled_job_created_idx').on(t.createdAt), // retention sweep
  ],
);

export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type NewCalendarEventRow = typeof calendarEvents.$inferInsert;
export type EventOccurrenceRow = typeof eventOccurrences.$inferSelect;
export type NewEventOccurrenceRow = typeof eventOccurrences.$inferInsert;
export type ScheduledJobRow = typeof scheduledJobs.$inferSelect;
export type NewScheduledJobRow = typeof scheduledJobs.$inferInsert;
