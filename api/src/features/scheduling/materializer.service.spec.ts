import type { ConfigService } from '@nestjs/config';
import type { CalendarEventRow } from '../../infrastructure/database/schema/calendar.schema';
import {
  MaterializerService,
  remindersFor,
  seriesOf,
} from './materializer.service';

const CONFIG = { materializeHorizonDays: 90, materializeBatch: 200 };

function event(over: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: 'event-1',
    ownerUserId: 'user-1',
    title: 'Standup',
    timezone: 'Australia/Melbourne',
    startLocal: '2025-10-01 09:00:00',
    durationMinutes: 30,
    frequency: 'daily',
    recurrenceInterval: 1,
    byWeekday: [],
    recurrenceCount: null,
    recurrenceUntilLocal: null,
    reminderOffsetsMs: [900_000],
    version: 1,
    status: 'confirmed',
    isDeleted: false,
    ...over,
  } as CalendarEventRow;
}

describe('remindersFor', () => {
  const startsAt = new Date('2025-10-01T09:00:00Z');

  it('schedules one job per configured lead time', () => {
    const rows = remindersFor(
      event({ reminderOffsetsMs: [900_000, 3_600_000] }),
      'occ-1',
      startsAt,
      new Date('2025-10-01T00:00:00Z'),
    );
    expect(rows.map((r) => r.runAt.toISOString())).toEqual([
      '2025-10-01T08:45:00.000Z',
      '2025-10-01T08:00:00.000Z',
    ]);
    expect(rows.map((r) => r.dedupeKey)).toEqual([
      'event_reminder:occ-1:900000',
      'event_reminder:occ-1:3600000',
    ]);
  });

  it('creates nothing for a lead time that has already elapsed', () => {
    // "15 minutes before" for a meeting starting in five is not a reminder,
    // and creating it would land in `overdue_5m` — the one number that must
    // mean "the poller is behind" and nothing else.
    const rows = remindersFor(
      event(),
      'occ-1',
      startsAt,
      new Date('2025-10-01T08:55:00Z'),
    );
    expect(rows).toEqual([]);
  });

  it('carries the event version onto every job', () => {
    const rows = remindersFor(
      event({ version: 7 }),
      'occ-1',
      startsAt,
      new Date('2025-01-01T00:00:00Z'),
    );
    expect(rows[0].eventVersion).toBe(7);
  });

  it('ignores duplicate and nonsensical offsets', () => {
    const rows = remindersFor(
      event({ reminderOffsetsMs: [900_000, 900_000, -1] }),
      'occ-1',
      startsAt,
      new Date('2025-01-01T00:00:00Z'),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('seriesOf', () => {
  it('reads the rule off the row in floating time', () => {
    const series = seriesOf(
      event({ recurrenceUntilLocal: '2025-12-01 09:00:00' }),
    );
    expect(series.startLocal).toMatchObject({ year: 2025, month: 10, hour: 9 });
    expect(series.rule.untilLocal).toMatchObject({ month: 12 });
    expect(series.timeZone).toBe('Australia/Melbourne');
  });
});

describe('MaterializerService', () => {
  let calendar: {
    dueForMaterialization: jest.Mock;
    upsertOccurrences: jest.Mock;
    setMaterializedThrough: jest.Mock;
  };
  let jobs: {
    insertJobs: jest.Mock;
    deleteFuturePendingForOccurrence: jest.Mock;
  };
  let materializer: MaterializerService;

  beforeEach(() => {
    calendar = {
      dueForMaterialization: jest.fn().mockResolvedValue([]),
      upsertOccurrences: jest.fn().mockResolvedValue([]),
      setMaterializedThrough: jest.fn().mockResolvedValue(undefined),
    };
    jobs = {
      insertJobs: jest.fn().mockImplementation((rows) => Promise.resolve(rows)),
      deleteFuturePendingForOccurrence: jest.fn().mockResolvedValue(0),
    };
    materializer = new MaterializerService(
      calendar as never,
      jobs as never,
      { getOrThrow: () => CONFIG } as unknown as ConfigService,
    );
  });

  it('expands the horizon and schedules the reminders it implies', async () => {
    const now = new Date('2025-10-01T00:00:00Z');
    calendar.upsertOccurrences.mockImplementation((rows: unknown[]) =>
      Promise.resolve(
        rows.map((r, i) => ({
          ...(r as object),
          id: `occ-${i}`,
          startsAt: (r as { startsAt: Date }).startsAt,
        })),
      ),
    );

    const result = await materializer.materializeEvent(
      event(),
      now,
      new Date('2025-10-04T00:00:00Z'),
    );
    expect(result.occurrencesCreated).toBeGreaterThan(0);
    expect(result.jobsCreated).toBe(result.occurrencesCreated);
    expect(calendar.setMaterializedThrough).toHaveBeenCalledWith(
      'event-1',
      new Date('2025-10-04T00:00:00Z'),
      undefined,
    );
  });

  it('schedules nothing for occurrences that already existed', async () => {
    // `upsertOccurrences` returns only the rows it inserted. An override
    // collides, is left alone, and must not have its reminders rewritten.
    calendar.upsertOccurrences.mockResolvedValue([]);
    const result = await materializer.materializeEvent(
      event(),
      new Date('2025-10-01T00:00:00Z'),
      new Date('2025-10-04T00:00:00Z'),
    );
    expect(result.jobsCreated).toBe(0);
    expect(jobs.insertJobs).toHaveBeenCalledWith([], undefined);
  });

  it('derives the horizon from the configured window', () => {
    const end = materializer.horizonEnd(new Date('2025-01-01T00:00:00Z'));
    expect(end.toISOString()).toBe('2025-04-01T00:00:00.000Z');
  });

  it('bounds the nightly pass by the configured batch', async () => {
    await materializer.run(new Date('2025-10-01T00:00:00Z'));
    expect(calendar.dueForMaterialization).toHaveBeenCalledWith(
      new Date('2025-12-30T00:00:00Z'),
      200,
    );
  });

  it('reschedules only the moved instance, not the whole series', async () => {
    // Deleting the event's future work here would silently drop the reminders
    // of every other instance in the series.
    await materializer.rescheduleOccurrence(
      event(),
      'occ-5',
      new Date('2025-10-02T09:00:00Z'),
      new Date('2025-10-01T00:00:00Z'),
    );
    expect(jobs.deleteFuturePendingForOccurrence).toHaveBeenCalledWith(
      'occ-5',
      new Date('2025-10-01T00:00:00Z'),
      undefined,
    );
  });
});
