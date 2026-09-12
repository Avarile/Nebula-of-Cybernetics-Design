import type { CalendarEventRow } from '../../infrastructure/database/schema/calendar.schema';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { CalendarService } from './calendar.service';
import type { CreateEventDto, UpdateEventDto } from './dto/calendar.dto';

const OWNER = {
  kind: 'user' as const,
  userId: 'user-1',
  role: 'user' as const,
};
const OTHER = {
  kind: 'user' as const,
  userId: 'user-2',
  role: 'user' as const,
};
const ADMIN = {
  kind: 'user' as const,
  userId: 'admin',
  role: 'admin' as const,
};

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
    location: null,
    projectId: null,
    ...over,
  } as CalendarEventRow;
}

const createDto = (over: Partial<CreateEventDto> = {}): CreateEventDto =>
  ({
    title: 'Standup',
    timezone: 'Australia/Melbourne',
    startLocal: '2025-10-01 09:00',
    durationMinutes: 30,
    allDay: false,
    status: 'confirmed',
    frequency: 'daily',
    interval: 1,
    byWeekday: [],
    reminderOffsetsMs: [900_000],
    ...over,
  }) as CreateEventDto;

describe('CalendarService', () => {
  let db: { transaction: jest.Mock };
  let calendar: Record<string, jest.Mock>;
  let jobs: Record<string, jest.Mock>;
  let materializer: Record<string, jest.Mock>;
  let profiles: { get: jest.Mock };
  let service: CalendarService;

  beforeEach(() => {
    // Run the callback with a sentinel executor, so the spec can assert that
    // every write of an edit lands on ONE transaction.
    db = {
      transaction: jest.fn((cb: (tx: unknown) => unknown) => cb('TX')),
    };
    calendar = {
      create: jest.fn().mockResolvedValue(event()),
      findById: jest.fn().mockResolvedValue(event()),
      findLiveById: jest.fn().mockResolvedValue(event()),
      listForOwner: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      updateWithVersionBump: jest.fn().mockResolvedValue(event({ version: 2 })),
      softDelete: jest.fn().mockResolvedValue(true),
      deleteFutureGeneratedOccurrences: jest.fn().mockResolvedValue(0),
      cancelFutureOccurrences: jest.fn().mockResolvedValue(0),
      futureOverrides: jest.fn().mockResolvedValue([]),
      listRange: jest.fn().mockResolvedValue([]),
      findOccurrence: jest.fn().mockResolvedValue(null),
      overrideOccurrence: jest.fn(),
    };
    jobs = {
      deleteFuturePending: jest.fn().mockResolvedValue(0),
      deleteFuturePendingForOccurrence: jest.fn().mockResolvedValue(0),
    };
    materializer = {
      materializeEvent: jest.fn().mockResolvedValue({ eventId: 'event-1' }),
      rescheduleOccurrence: jest.fn().mockResolvedValue(0),
      horizonEnd: jest.fn().mockReturnValue(new Date('2026-01-01T00:00:00Z')),
    };
    profiles = {
      get: jest.fn().mockResolvedValue({ timezone: 'Australia/Melbourne' }),
    };

    service = new CalendarService(
      db as never,
      calendar as never,
      jobs as never,
      materializer as never,
      profiles as never,
      new ExceptionService(),
    );
  });

  describe('create', () => {
    it('expands the event inside the transaction that created it', async () => {
      // An event that is briefly present but unexpanded is an event whose first
      // reminder silently never fires.
      await service.create(createDto(), OWNER);
      expect(calendar.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: 'user-1' }),
        'TX',
      );
      expect(materializer.materializeEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Date),
        expect.any(Date),
        'TX',
      );
    });

    it('normalizes a bare date to local midnight', async () => {
      await service.create(createDto({ startLocal: '2025-10-01' }), OWNER);
      expect(calendar.create.mock.calls[0][0].startLocal).toBe(
        '2025-10-01 00:00:00',
      );
    });
  });

  describe('rule validation', () => {
    const expectRejects = (dto: CreateEventDto) =>
      expect(service.create(dto, OWNER)).rejects.toMatchObject({
        code: ErrorCode.CALENDAR_RULE_INVALID,
      });

    it('refuses both a count and an end date', () =>
      // Two ends of the same series; they will disagree. RFC 5545 forbids both
      // for the same reason.
      expectRejects(createDto({ count: 5, untilLocal: '2025-12-01 09:00' })));

    it('refuses byWeekday outside a weekly rule', () =>
      expectRejects(createDto({ frequency: 'daily', byWeekday: [1, 3] })));

    it('refuses a series that ends before it starts', () =>
      expectRejects(createDto({ untilLocal: '2024-01-01 09:00' })));

    it('refuses a count on a non-recurring event', () =>
      expectRejects(createDto({ frequency: 'none', count: 3 })));

    it('accepts a weekly rule with weekdays', async () => {
      await expect(
        service.create(
          createDto({ frequency: 'weekly', byWeekday: [1, 3] }),
          OWNER,
        ),
      ).resolves.toBeDefined();
    });

    it('validates the MERGED rule on an edit, not just the patch', async () => {
      // The stored event already carries a count; adding an end date is only
      // invalid in combination, which a patch-only check cannot see.
      calendar.findLiveById.mockResolvedValue(event({ recurrenceCount: 5 }));
      await expect(
        service.update(
          'event-1',
          { untilLocal: '2025-12-01 09:00' } as UpdateEventDto,
          OWNER,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CALENDAR_RULE_INVALID });
    });
  });

  describe('update', () => {
    it('bumps the version, drops future pending work and re-expands, together', async () => {
      await service.update('event-1', { title: 'Renamed' }, OWNER);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(calendar.updateWithVersionBump).toHaveBeenCalledWith(
        'event-1',
        { title: 'Renamed' },
        'TX',
      );
      // Only `pending`: a claimed job is mid-flight in another process and
      // fails its own version check rather than being deleted from under it.
      expect(jobs.deleteFuturePending).toHaveBeenCalledWith(
        'event-1',
        expect.any(Date),
        'TX',
      );
      expect(calendar.deleteFutureGeneratedOccurrences).toHaveBeenCalledWith(
        'event-1',
        expect.any(Date),
        'TX',
      );
      // Re-expanded at the NEW version, so the replacement jobs are not stale.
      expect(materializer.materializeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2 }),
        expect.any(Date),
        expect.any(Date),
        'TX',
      );
    });

    it('reschedules the reminders of every surviving override', async () => {
      // Regression: the edit deletes the event's future pending jobs, but
      // re-expansion only schedules work for occurrences it INSERTS — and an
      // override already exists, so it collides and gets nothing back. Editing
      // a series silently stripped the reminders off every personalised
      // instance.
      calendar.futureOverrides.mockResolvedValue([
        { id: 'occ-9', startsAt: new Date('2025-10-05T09:00:00Z') },
      ]);
      await service.update('event-1', { title: 'Renamed' }, OWNER);
      expect(materializer.rescheduleOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2 }),
        'occ-9',
        new Date('2025-10-05T09:00:00Z'),
        expect.any(Date),
        'TX',
      );
    });

    it('sends only the fields the caller supplied', async () => {
      await service.update('event-1', { location: null }, OWNER);
      expect(calendar.updateWithVersionBump.mock.calls[0][1]).toEqual({
        location: null,
      });
    });
  });

  describe('cancel and delete', () => {
    it('cancels without hunting down jobs one by one', async () => {
      await service.cancel('event-1', OWNER);
      expect(calendar.updateWithVersionBump).toHaveBeenCalledWith(
        'event-1',
        { status: 'cancelled' },
        'TX',
      );
      expect(calendar.cancelFutureOccurrences).toHaveBeenCalled();
      expect(jobs.deleteFuturePending).toHaveBeenCalled();
    });

    it('soft-deletes and stands down the future work in one transaction', async () => {
      await service.remove('event-1', OWNER);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(calendar.softDelete).toHaveBeenCalledWith('event-1', 'TX');
      expect(jobs.deleteFuturePending).toHaveBeenCalled();
    });
  });

  describe('access', () => {
    it("answers 404 for another user's event, not 403", async () => {
      // 403 would confirm the id exists, which a personal calendar should not
      // disclose.
      await expect(service.get('event-1', OTHER)).rejects.toMatchObject({
        code: ErrorCode.CALENDAR_EVENT_NOT_FOUND,
      });
    });

    it('lets an admin through', async () => {
      await expect(service.get('event-1', ADMIN)).resolves.toBeDefined();
    });

    it('answers 404 for a missing event', async () => {
      calendar.findLiveById.mockResolvedValue(null);
      await expect(service.get('event-1', OWNER)).rejects.toMatchObject({
        code: ErrorCode.CALENDAR_EVENT_NOT_FOUND,
      });
    });
  });

  describe('listRange', () => {
    it('derives UTC bounds from the local range and the viewer zone', async () => {
      // The bug this prevents: `09:00 1 September` in Melbourne is `23:00 31
      // August` UTC, so naive bounds drop the first morning of the month.
      await service.listRange(
        { from: '2025-09-01', to: '2025-10-01', limit: 500 } as never,
        OWNER,
      );
      expect(calendar.listRange).toHaveBeenCalledWith(
        'user-1',
        new Date('2025-08-31T14:00:00Z'),
        new Date('2025-09-30T14:00:00Z'),
        500,
      );
    });

    it('falls back to the profile timezone', async () => {
      profiles.get.mockResolvedValue({ timezone: 'UTC' });
      await service.listRange(
        { from: '2025-09-01', to: '2025-10-01', limit: 10 } as never,
        OWNER,
      );
      expect(calendar.listRange).toHaveBeenCalledWith(
        'user-1',
        new Date('2025-09-01T00:00:00Z'),
        new Date('2025-10-01T00:00:00Z'),
        10,
      );
    });

    it('rejects an inverted range as a validation error', async () => {
      await expect(
        service.listRange(
          { from: '2025-10-01', to: '2025-09-01', limit: 10 } as never,
          OWNER,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('hides occurrences of a cancelled event', async () => {
      calendar.listRange.mockResolvedValue([
        {
          occurrence: { id: 'o1', startsAt: new Date(), titleOverride: null },
          event: event({ status: 'cancelled' }),
        },
      ]);
      const rows = await service.listRange(
        { from: '2025-09-01', to: '2025-10-01', limit: 10 } as never,
        OWNER,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('single-instance override', () => {
    const occurrence = {
      id: 'occ-1',
      eventId: 'event-1',
      startLocal: '2025-10-02 09:00:00',
      endLocal: '2025-10-02 09:30:00',
      timezone: 'Australia/Melbourne',
      status: 'scheduled' as const,
    };

    beforeEach(() => {
      calendar.findOccurrence.mockResolvedValue(occurrence);
      calendar.overrideOccurrence.mockImplementation((id, patch) =>
        Promise.resolve({ ...occurrence, ...patch, isOverride: true }),
      );
    });

    it('moves the instance and leaves its identity alone', async () => {
      // `original_start` is never in the patch: it is what lets every future
      // re-expansion recognise this row and skip it.
      const moved = await service.moveOccurrence(
        'occ-1',
        { startLocal: '2025-10-02 14:00' },
        OWNER,
      );
      const patch = calendar.overrideOccurrence.mock.calls[0][1];
      expect(patch).not.toHaveProperty('originalStart');
      expect(patch.startLocal).toBe('2025-10-02 14:00:00');
      // Duration is preserved in wall-clock minutes, not recomputed from UTC.
      expect(patch.endLocal).toBe('2025-10-02 14:30:00');
      expect(moved.isOverride).toBe(true);
    });

    it('reschedules the moved instance only', async () => {
      await service.moveOccurrence(
        'occ-1',
        { startLocal: '2025-10-02 14:00' },
        OWNER,
      );
      expect(materializer.rescheduleOccurrence).toHaveBeenCalledWith(
        expect.anything(),
        'occ-1',
        expect.any(Date),
        expect.any(Date),
        'TX',
      );
    });

    it('cancels one instance and drops just its jobs', async () => {
      await service.cancelOccurrence('occ-1', OWNER);
      expect(calendar.overrideOccurrence).toHaveBeenCalledWith(
        'occ-1',
        { status: 'cancelled' },
        'TX',
      );
      expect(jobs.deleteFuturePendingForOccurrence).toHaveBeenCalledWith(
        'occ-1',
        expect.any(Date),
        'TX',
      );
    });

    it('answers 404 for an unknown occurrence', async () => {
      calendar.findOccurrence.mockResolvedValue(null);
      await expect(
        service.moveOccurrence(
          'occ-1',
          { startLocal: '2025-10-02 14:00' },
          OWNER,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND,
      });
    });
  });
});
