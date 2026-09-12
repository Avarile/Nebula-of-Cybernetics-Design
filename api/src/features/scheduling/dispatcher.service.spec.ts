import type { ConfigService } from '@nestjs/config';
import type {
  CalendarEventRow,
  EventOccurrenceRow,
  ScheduledJobRow,
} from '../../infrastructure/database/schema/calendar.schema';
import { ScheduledJobHandlerRegistry } from '../../infrastructure/scheduling/job-handler.registry';
import { DispatcherService } from './dispatcher.service';

const CONFIG = {
  tickIntervalMs: 10_000,
  tickBudgetMs: 8_000,
  batchSize: 2,
  leaseSeconds: 60,
  concurrency: 2,
  handlerTimeoutMs: 50,
  backoffBaseMs: 30_000,
  backoffCapMs: 1_800_000,
};

function job(over: Partial<ScheduledJobRow> = {}): ScheduledJobRow {
  return {
    id: 'job-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    kind: 'event_reminder',
    eventId: 'event-1',
    occurrenceId: 'occ-1',
    eventVersion: 1,
    runAt: new Date(),
    status: 'claimed',
    attempts: 1,
    maxAttempts: 5,
    leaseExpiresAt: new Date(),
    claimedBy: 'test',
    lastError: null,
    dedupeKey: 'event_reminder:occ-1:900000',
    payload: { offsetMs: 900_000 },
    subjectType: 'calendar_event',
    subjectId: 'event-1',
    completedAt: null,
    ...over,
  };
}

const event = (over: Partial<CalendarEventRow> = {}) =>
  ({
    id: 'event-1',
    isDeleted: false,
    status: 'confirmed',
    version: 1,
    ...over,
  }) as CalendarEventRow;

const occurrence = (over: Partial<EventOccurrenceRow> = {}) =>
  ({ id: 'occ-1', status: 'scheduled', ...over }) as EventOccurrenceRow;

describe('DispatcherService', () => {
  let jobs: {
    claimDue: jest.Mock;
    markDone: jest.Mock;
    markSkipped: jest.Mock;
    markFailed: jest.Mock;
  };
  let calendar: { findById: jest.Mock; findOccurrence: jest.Mock };
  let registry: ScheduledJobHandlerRegistry;
  let dispatcher: DispatcherService;

  beforeEach(() => {
    jobs = {
      claimDue: jest.fn().mockResolvedValue([]),
      markDone: jest.fn().mockResolvedValue(undefined),
      markSkipped: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    calendar = {
      findById: jest.fn().mockResolvedValue(event()),
      findOccurrence: jest.fn().mockResolvedValue(occurrence()),
    };
    registry = new ScheduledJobHandlerRegistry();
    dispatcher = new DispatcherService(
      jobs as never,
      calendar as never,
      registry,
      { getOrThrow: () => CONFIG } as unknown as ConfigService,
    );
  });

  describe('staleness', () => {
    it('drops a job scheduled against an older version of the event', async () => {
      // THE property of this design. The job row is a reminder that something
      // might need doing; the truth is re-read here. An edit bumps the version
      // and every job created against the old one identifies itself as stale.
      registry.register('event_reminder', jest.fn());
      calendar.findById.mockResolvedValue(event({ version: 3 }));

      expect(await dispatcher.execute(job({ eventVersion: 1 }))).toBe(
        'skipped',
      );
      expect(jobs.markSkipped).toHaveBeenCalledWith(
        'job-1',
        expect.stringContaining('stale'),
      );
    });

    it('runs a job whose version still matches', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      registry.register('event_reminder', handler);

      expect(await dispatcher.execute(job({ eventVersion: 1 }))).toBe('done');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          calendar: {
            event: expect.any(Object),
            occurrence: expect.any(Object),
          },
        }),
      );
      expect(jobs.markDone).toHaveBeenCalledWith('job-1');
    });

    it.each([
      ['deleted event', { event: event({ isDeleted: true }) }],
      ['cancelled event', { event: event({ status: 'cancelled' }) }],
    ])('skips a %s', async (_label, { event: row }) => {
      registry.register('event_reminder', jest.fn());
      calendar.findById.mockResolvedValue(row);
      expect(await dispatcher.execute(job())).toBe('skipped');
    });

    it('skips a cancelled occurrence', async () => {
      registry.register('event_reminder', jest.fn());
      calendar.findOccurrence.mockResolvedValue(
        occurrence({ status: 'cancelled' }),
      );
      expect(await dispatcher.execute(job())).toBe('skipped');
      expect(jobs.markSkipped).toHaveBeenCalledWith(
        'job-1',
        'occurrence cancelled',
      );
    });

    it('runs a standalone job without touching the calendar', async () => {
      // The seam other modules consume. There is no rule to be stale against,
      // so the dispatcher asks the calendar nothing and the handler decides
      // for itself whether the work is still wanted.
      const handler = jest.fn().mockResolvedValue(undefined);
      registry.register('invoice.chase', handler);

      const standalone = job({
        kind: 'invoice.chase',
        eventId: null,
        occurrenceId: null,
        eventVersion: null,
        subjectType: 'invoice',
        subjectId: 'inv-1',
      });
      expect(await dispatcher.execute(standalone)).toBe('done');
      expect(handler).toHaveBeenCalledWith({
        job: standalone,
        calendar: null,
      });
      expect(calendar.findById).not.toHaveBeenCalled();
      expect(calendar.findOccurrence).not.toHaveBeenCalled();
    });

    it('still retries and dead-letters a standalone job', async () => {
      registry.register('invoice.chase', () =>
        Promise.reject(new Error('gateway down')),
      );
      const standalone = job({
        kind: 'invoice.chase',
        eventId: null,
        occurrenceId: null,
        eventVersion: null,
        attempts: 5,
        maxAttempts: 5,
      });
      expect(await dispatcher.execute(standalone)).toBe('failed');
      expect(jobs.markFailed).toHaveBeenCalledWith(
        'job-1',
        'gateway down',
        null,
      );
    });

    it('skips rather than fails when no handler is registered', async () => {
      // Never "succeeds": an unhandled kind means work is piling up while the
      // metrics look clean.
      expect(await dispatcher.execute(job({ kind: 'event_end' }))).toBe(
        'skipped',
      );
      expect(jobs.markSkipped).toHaveBeenCalledWith(
        'job-1',
        expect.stringContaining('no handler'),
      );
      expect(jobs.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('failure', () => {
    it('retries with backoff while attempts remain', async () => {
      registry.register('event_reminder', () =>
        Promise.reject(new Error('smtp down')),
      );
      expect(await dispatcher.execute(job({ attempts: 2 }))).toBe('failed');

      const [id, message, retryAt] = jobs.markFailed.mock.calls[0];
      expect(id).toBe('job-1');
      expect(message).toBe('smtp down');
      expect(retryAt).toBeInstanceOf(Date);
    });

    it('dead-letters once the attempt budget is spent', async () => {
      // `attempts` was incremented at CLAIM time, so a handler that kills the
      // worker still burns one. Increment on failure instead and a poison job
      // retries forever, taking the process with it each time.
      registry.register('event_reminder', () =>
        Promise.reject(new Error('poison')),
      );
      expect(
        await dispatcher.execute(job({ attempts: 5, maxAttempts: 5 })),
      ).toBe('failed');
      expect(jobs.markFailed).toHaveBeenCalledWith('job-1', 'poison', null);
    });

    it('bounds a hung handler below the lease', async () => {
      // A handler that outlives its lease gets its job reaped and run again
      // while it is still running — the duplicate the lease exists to prevent.
      registry.register(
        'event_reminder',
        () => new Promise<void>(() => undefined),
      );
      expect(await dispatcher.execute(job())).toBe('failed');
      const [, message] = jobs.markFailed.mock.calls[0];
      expect(message).toMatch(/timed out after 50ms/);
    });
  });

  describe('tick', () => {
    it('claims until the queue is drained', async () => {
      registry.register(
        'event_reminder',
        jest.fn().mockResolvedValue(undefined),
      );
      jobs.claimDue
        .mockResolvedValueOnce([job({ id: 'a' }), job({ id: 'b' })])
        .mockResolvedValueOnce([job({ id: 'c' })]);

      const result = await dispatcher.tick();
      expect(result.claimed).toBe(3);
      expect(result.done).toBe(3);
      // A short batch means the due queue is empty; no third claim.
      expect(jobs.claimDue).toHaveBeenCalledTimes(2);
    });

    it('counts each outcome separately', async () => {
      registry.register('event_reminder', (ctx) =>
        ctx.job.id === 'b'
          ? Promise.reject(new Error('no'))
          : Promise.resolve(),
      );
      calendar.findById.mockImplementation((id: string) =>
        Promise.resolve(event({ id, version: 1 })),
      );
      jobs.claimDue
        .mockResolvedValueOnce([job({ id: 'a' }), job({ id: 'b' })])
        .mockResolvedValueOnce([job({ id: 'c', eventVersion: 99 })]);

      const result = await dispatcher.tick();
      expect(result).toMatchObject({ done: 1, failed: 1, skipped: 1 });
    });

    it('does nothing when nothing is due', async () => {
      const result = await dispatcher.tick();
      expect(result.claimed).toBe(0);
      expect(jobs.claimDue).toHaveBeenCalledTimes(1);
    });

    it('claims with the configured batch size and lease', async () => {
      await dispatcher.tick();
      expect(jobs.claimDue).toHaveBeenCalledWith(2, 60, expect.any(String));
    });

    it('never runs more than `concurrency` handlers at once', async () => {
      let inFlight = 0;
      let peak = 0;
      registry.register('event_reminder', async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
      });
      jobs.claimDue.mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, i) => job({ id: `j${i}` })),
      );

      await dispatcher.tick();
      // The ceiling is held against the pg pool, not chosen for elegance.
      expect(peak).toBeLessThanOrEqual(CONFIG.concurrency);
      expect(peak).toBeGreaterThan(1);
    });
  });
});
