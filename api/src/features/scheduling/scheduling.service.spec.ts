import type { ConfigService } from '@nestjs/config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ScheduledJobHandlerRegistry } from '../../infrastructure/scheduling/job-handler.registry';
import { SchedulingService } from './scheduling.service';

const CONFIG = { maxAttempts: 5, overdueAlertThreshold: 1 };

describe('SchedulingService', () => {
  let jobs: Record<string, jest.Mock>;
  let calendar: Record<string, jest.Mock>;
  let registry: ScheduledJobHandlerRegistry;
  let service: SchedulingService;

  beforeEach(() => {
    jobs = {
      health: jest.fn().mockResolvedValue({
        pending: 4,
        overdue5m: 0,
        inFlight: 1,
        dead: 0,
        oldestDueAgeSeconds: 2,
      }),
      insertJobs: jest.fn().mockImplementation((rows) => Promise.resolve(rows)),
      listDead: jest.fn().mockResolvedValue([]),
      requeueDead: jest.fn().mockResolvedValue({ id: 'job-1' }),
      listForOccurrence: jest.fn().mockResolvedValue([]),
      purgeTerminalOlderThan: jest.fn().mockResolvedValue(7),
      pendingKinds: jest.fn().mockResolvedValue([]),
      cancelByDedupeKey: jest.fn().mockResolvedValue(true),
      cancelBySubject: jest.fn().mockResolvedValue(3),
      listBySubject: jest.fn().mockResolvedValue([]),
      findByDedupeKey: jest.fn().mockResolvedValue(null),
    };
    calendar = {
      findOccurrence: jest
        .fn()
        .mockResolvedValue({ id: 'occ-1', eventId: 'event-1' }),
      findLiveById: jest.fn().mockResolvedValue({ id: 'event-1', version: 4 }),
    };
    registry = new ScheduledJobHandlerRegistry();
    registry.register('event_start', jest.fn());
    service = new SchedulingService(
      jobs as never,
      calendar as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
      new ExceptionService(),
      { getOrThrow: () => CONFIG } as unknown as ConfigService,
    );
  });

  describe('status', () => {
    it('is healthy while nothing is overdue', async () => {
      await expect(service.status()).resolves.toMatchObject({
        degraded: false,
        oldestDueAgeSeconds: 2,
      });
    });

    it('is degraded the moment work is more than five minutes late', async () => {
      // `overdue_5m > 0` is the alert that matters: it means the poller is not
      // keeping up, or is dead, and nothing else reports that.
      jobs.health.mockResolvedValue({
        pending: 900,
        overdue5m: 12,
        inFlight: 0,
        dead: 3,
        oldestDueAgeSeconds: 4_000,
      });
      await expect(service.status()).resolves.toMatchObject({ degraded: true });
    });

    it('reports which kinds actually have a handler', async () => {
      registry.register('event_reminder', jest.fn());
      await expect(service.status()).resolves.toMatchObject({
        registeredKinds: ['event_reminder', 'event_start'],
      });
    });

    it('surfaces pending work nobody will ever run', async () => {
      // A removed or renamed module leaves a backlog that shows up in no other
      // counter — not `dead`, not `overdue5m` — so it accrues invisibly.
      jobs.pendingKinds.mockResolvedValue([
        { kind: 'event_start', count: 2 },
        { kind: 'invoice.chase', count: 40 },
      ]);
      await expect(service.status()).resolves.toMatchObject({
        orphanedKinds: [{ kind: 'invoice.chase', count: 40 }],
      });
    });
  });

  describe('schedule', () => {
    it('schedules standalone work with no calendar behind it', async () => {
      // The seam other modules consume: a durable timer, not a calendar entry.
      registry.register('invoice.chase', jest.fn());
      const row = await service.schedule({
        kind: 'invoice.chase',
        runAt: new Date('2025-10-01T09:00:00Z'),
        dedupeKey: 'invoice.chase:inv-1:first',
        subject: { type: 'invoice', id: 'inv-1' },
        payload: { stage: 'first' },
      });
      expect(row).toMatchObject({
        kind: 'invoice.chase',
        eventId: null,
        occurrenceId: null,
        eventVersion: null,
        subjectType: 'invoice',
        subjectId: 'inv-1',
      });
      // Nothing was asked of the calendar at all.
      expect(calendar.findOccurrence).not.toHaveBeenCalled();
    });

    it('refuses a kind no handler will ever run', async () => {
      // Fails at the call site rather than becoming a row that is skipped
      // six hours later in a sweep nobody is watching.
      await expect(
        service.schedule({
          kind: 'typo.kind',
          runAt: new Date(),
          dedupeKey: 'x',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.SCHEDULER_HANDLER_NOT_REGISTERED,
      });
      expect(jobs.insertJobs).not.toHaveBeenCalled();
    });

    it('honours a caller-supplied attempt budget', async () => {
      registry.register('invoice.chase', jest.fn());
      const row = await service.schedule({
        kind: 'invoice.chase',
        runAt: new Date(),
        dedupeKey: 'k',
        maxAttempts: 2,
      });
      expect(row).toMatchObject({ maxAttempts: 2 });
    });

    it("stamps the event's CURRENT version onto the job", async () => {
      // Taking the version from the caller would make the staleness check
      // meaningless: an invented version either never runs or never expires.
      const row = await service.schedule({
        kind: 'event_start',
        occurrenceId: 'occ-1',
        runAt: new Date('2025-10-01T09:00:00Z'),
        dedupeKey: 'event_start:occ-1',
      });
      expect(row).toMatchObject({ eventVersion: 4, maxAttempts: 5 });
    });

    it('treats a duplicate dedupe key as success, not conflict', async () => {
      // Idempotency is the point of the key; a retried caller must not 409.
      jobs.insertJobs.mockResolvedValue([]);
      await expect(
        service.schedule({
          kind: 'event_start',
          occurrenceId: 'occ-1',
          runAt: new Date(),
          dedupeKey: 'dup',
        }),
      ).resolves.toBeNull();
    });

    it('refuses to schedule against an unknown occurrence', async () => {
      calendar.findOccurrence.mockResolvedValue(null);
      await expect(
        service.schedule({
          kind: 'event_start',
          occurrenceId: 'nope',
          runAt: new Date(),
          dedupeKey: 'x',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CALENDAR_OCCURRENCE_NOT_FOUND,
      });
    });
  });

  describe('cancellation', () => {
    it('cancels by the key the work was booked under', async () => {
      await expect(service.cancel('invoice.chase:inv-1:first')).resolves.toBe(
        true,
      );
      expect(jobs.cancelByDedupeKey).toHaveBeenCalledWith(
        'invoice.chase:inv-1:first',
        undefined,
      );
    });

    it('cancels everything about one subject, on the caller transaction', async () => {
      // "The invoice was paid" and "its chasers are cancelled" must commit
      // together, or a rollback leaves reminders live for a payment that never
      // landed.
      await expect(
        service.cancelFor('invoice', 'inv-1', 'TX' as never),
      ).resolves.toBe(3);
      expect(jobs.cancelBySubject).toHaveBeenCalledWith(
        'invoice',
        'inv-1',
        'TX',
      );
    });

    it('reports nothing-to-cancel as false rather than an error', async () => {
      // A caller cancelling something that already fired is the normal race.
      jobs.cancelByDedupeKey.mockResolvedValue(false);
      await expect(service.cancel('gone')).resolves.toBe(false);
    });

    it('lists what is scheduled for a subject', async () => {
      await service.jobsFor('invoice', 'inv-1');
      expect(jobs.listBySubject).toHaveBeenCalledWith('invoice', 'inv-1', 100);
    });
  });

  describe('dead letters', () => {
    it('requeues with a fresh attempt budget', async () => {
      await expect(service.requeueDead('job-1')).resolves.toMatchObject({
        id: 'job-1',
      });
      expect(jobs.requeueDead).toHaveBeenCalledWith('job-1', expect.any(Date));
    });

    it('answers 404 for a job that is not dead', async () => {
      jobs.requeueDead.mockResolvedValue(null);
      await expect(service.requeueDead('job-1')).rejects.toMatchObject({
        code: ErrorCode.SCHEDULED_JOB_NOT_FOUND,
      });
    });
  });

  it('exposes the retention purge the module registers', async () => {
    await expect(service.purgeTerminalOlderThan(new Date(), 100)).resolves.toBe(
      7,
    );
  });
});
