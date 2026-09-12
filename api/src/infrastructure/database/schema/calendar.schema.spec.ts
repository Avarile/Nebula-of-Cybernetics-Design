import {
  calendarEventStatus,
  calendarEvents,
  eventOccurrenceStatus,
  eventOccurrences,
  calendarRecurrenceFrequency,
  CALENDAR_JOB_KINDS,
  scheduledJobStatus,
  scheduledJobs,
} from './calendar.schema';

describe('calendar schema', () => {
  it('stores the wall clock as a string, not a Date', () => {
    // A `timestamp without time zone` parsed into a JS Date picks up the
    // server's zone, which is the entire bug this column exists to avoid.
    expect(calendarEvents.startLocal.dataType).toBe('string');
    expect(eventOccurrences.startLocal.dataType).toBe('string');
    expect(eventOccurrences.endLocal.dataType).toBe('string');
  });

  it('derives the UTC instants as timestamptz', () => {
    expect(eventOccurrences.startsAt.dataType).toBe('date');
    expect(eventOccurrences.originalStart.dataType).toBe('date');
  });

  it('stores duration in wall-clock minutes rather than an end instant', () => {
    // A 09:00-10:00 meeting spanning a DST change is still 09:00-10:00 locally.
    expect(calendarEvents.durationMinutes.notNull).toBe(true);
    expect(calendarEvents.durationMinutes.default).toBe(0);
  });

  it('carries a version an edit can bump', () => {
    expect(calendarEvents.version.default).toBe(1);
  });

  it('cancels rather than deletes', () => {
    expect(calendarEventStatus.enumValues).toContain('cancelled');
    expect(eventOccurrenceStatus.enumValues).toEqual([
      'scheduled',
      'cancelled',
    ]);
  });

  it('separates a skipped job from a failed one', () => {
    // A stale or cancelled job is a correct outcome; conflating the two with a
    // failure hides real failures in the metrics.
    expect(scheduledJobStatus.enumValues).toContain('skipped');
    expect(scheduledJobStatus.enumValues).toContain('failed');
    expect(scheduledJobStatus.enumValues).toContain('dead');
  });

  it('starts every job pending and unattempted', () => {
    expect(scheduledJobs.status.default).toBe('pending');
    expect(scheduledJobs.attempts.default).toBe(0);
    expect(scheduledJobs.maxAttempts.default).toBe(5);
  });

  it('supports the recurrence frequencies the expander implements', () => {
    expect(calendarRecurrenceFrequency.enumValues).toEqual([
      'none',
      'daily',
      'weekly',
      'monthly',
      'yearly',
    ]);
  });

  it('keeps the job-kind vocabulary open', () => {
    // A pgEnum would make every new kind an ALTER TYPE — a migration to add a
    // line of code — so the vocabulary would harden around whatever the
    // calendar happened to need first.
    expect(scheduledJobs.kind.dataType).toBe('string');
    expect(scheduledJobs.kind.enumValues).toBeUndefined();
    expect(CALENDAR_JOB_KINDS.reminder).toBe('event_reminder');
  });

  it('makes the calendar linkage optional', () => {
    // The poller is not the calendar's. A job another module booked has no
    // event, no occurrence and no version to be stale against.
    expect(scheduledJobs.eventId.notNull).toBe(false);
    expect(scheduledJobs.occurrenceId.notNull).toBe(false);
    expect(scheduledJobs.eventVersion.notNull).toBe(false);
  });

  it('records what a job is about, for any module', () => {
    // Deliberately no FK: this table points at rows in modules it does not
    // import, exactly as `activity_log.entity_id` does.
    expect(scheduledJobs.subjectType.notNull).toBe(false);
    expect(scheduledJobs.subjectId.notNull).toBe(false);
  });

  it('requires a dedupe key so re-expansion inserts nothing', () => {
    expect(scheduledJobs.dedupeKey.notNull).toBe(true);
  });

  it('never nulls the occurrence identity', () => {
    // `original_start` is RECURRENCE-ID: immutable, even after a move.
    expect(eventOccurrences.originalStart.notNull).toBe(true);
    expect(eventOccurrences.isOverride.default).toBe(false);
  });
});
