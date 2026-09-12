import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/features/authorization/permissions.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { AuthorizationModule } from '../src/features/authorization/authorization.module';
import { SchedulingModule } from '../src/features/scheduling/scheduling.module';
import { SchedulingService } from '../src/features/scheduling/scheduling.service';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { CacheModule } from '../src/infrastructure/cache/cache.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../src/infrastructure/database/drizzle.constants';
import {
  eventOccurrences,
  scheduledJobs,
} from '../src/infrastructure/database/schema/calendar.schema';
import { notifications } from '../src/infrastructure/database/schema/notification.schema';
import { ErrorCode, ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { ScheduledJobHandlerRegistry } from '../src/infrastructure/scheduling/job-handler.registry';
import { QueueModule } from '../src/infrastructure/queue/queue.module';

/**
 * The parts of the scheduler that only exist in SQL.
 *
 * The unit suite covers the expander, the dispatcher's decisions and the
 * service wiring with mocks. What it cannot cover is the half that lives in
 * Postgres: `FOR UPDATE SKIP LOCKED`, the partial indexes, the unique index
 * that protects a single-instance override, and the wall-clock column that must
 * round-trip as a STRING rather than a `Date` reinterpreted in the server's
 * zone. That is what this file is for.
 *
 * Requires Postgres (migrated + seeded) and Redis. Run with
 * `pnpm test:e2e -- scheduling`.
 */
describe('Scheduling (e2e)', () => {
  let app: INestApplication;
  let db: DrizzleDB;
  let scheduler: SchedulingService;
  const stamp = String(Date.now());
  const email = `sched_user_${stamp}@e2e.local`;
  const password = 'scheduling-e2e-password-123';
  let access: string;
  let userId: string;
  let workerFlag: string | undefined;

  const MELBOURNE = 'Australia/Melbourne';

  beforeAll(async () => {
    // Stand the repeatables down: the ticks are driven by hand here so each
    // assertion sees a state it created, not one a background sweep raced it to.
    workerFlag = process.env.WORKER_ENABLED;
    process.env.WORKER_ENABLED = 'false';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        CacheModule,
        QueueModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        AuthorizationModule,
        UsersModule,
        SchedulingModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get<DrizzleDB>(DRIZZLE);
    scheduler = app.get(SchedulingService);

    const users = app.get(UsersService);
    const created = await users.create({ email, password, role: 'admin' });
    userId = created.id;
    access = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      // Leave nothing behind: cascades take the occurrences and jobs with the
      // events, and this suite is the only writer of these rows.
      await db
        .delete(notifications)
        .where(eq(notifications.recipientUserId, userId));
      await db.execute(
        sql`DELETE FROM calendar_event WHERE owner_user_id = ${userId}`,
      );
      await app.close();
    }
    if (workerFlag === undefined) delete process.env.WORKER_ENABLED;
    else process.env.WORKER_ENABLED = workerFlag;
  });

  const server = () => app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${access}`);

  const createEvent = async (body: Record<string, unknown>) =>
    (
      await auth(request(server()).post('/calendar/events'))
        .send({
          title: 'Standup',
          timezone: MELBOURNE,
          durationMinutes: 30,
          ...body,
        })
        .expect(201)
    ).body;

  const occurrencesOf = (eventId: string) =>
    db
      .select()
      .from(eventOccurrences)
      .where(eq(eventOccurrences.eventId, eventId))
      .orderBy(eventOccurrences.startsAt);

  const jobsOf = (eventId: string) =>
    db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.eventId, eventId))
      .orderBy(scheduledJobs.runAt);

  describe('wall clock', () => {
    it('round-trips the local start as a string, not a reinterpreted Date', async () => {
      // The whole reason `start_local` is `mode: 'string'`. A naive timestamp
      // parsed into a Date picks up the server's zone, and the value comes back
      // shifted by however many hours that happens to be.
      const event = await createEvent({
        startLocal: '2025-10-01 09:00',
        frequency: 'none',
      });
      expect(event.startLocal).toBe('2025-10-01 09:00:00');
      expect(event.timezone).toBe(MELBOURNE);
      expect(event.version).toBe(1);
    });

    it('holds 09:00 across a DST change and shifts the instant instead', async () => {
      const transition = nextTransition(MELBOURNE, 90);
      if (!transition) {
        // The horizon does not span a transition this run. The expander's DST
        // behaviour is proved exhaustively in `recurrence.spec.ts`; this case
        // only adds the Postgres round-trip, so skipping it loses nothing.
        return;
      }
      {
        const startLocal = `${isoDateIn(MELBOURNE, transition.getTime() - 2 * 86_400_000)} 09:00`;
        const event = await createEvent({ startLocal, frequency: 'daily' });
        const rows = await occurrencesOf(event.id);

        const before = rows[0];
        const after = rows.find(
          (r) => r.startsAt.getTime() > transition.getTime(),
        )!;
        // Same reading on the wall, an hour apart in UTC. That is the point,
        // and it has now survived a write and a read through Postgres.
        expect(before.startLocal.endsWith('09:00:00')).toBe(true);
        expect(after.startLocal.endsWith('09:00:00')).toBe(true);

        const dayMs = 86_400_000;
        const spanned = rows.filter(
          (r) =>
            r.startsAt.getTime() > transition.getTime() - 2 * dayMs &&
            r.startsAt.getTime() < transition.getTime() + 2 * dayMs,
        );
        const gaps = spanned
          .slice(1)
          .map((r, i) => r.startsAt.getTime() - spanned[i].startsAt.getTime());
        // A naive UTC expansion would make every gap exactly 24h and drift the
        // local time; a correct one makes exactly one gap 23h or 25h.
        expect(gaps.some((g) => g !== dayMs)).toBe(true);
      }
    });

    it('keeps the local range aligned to local days', async () => {
      // `09:00` on the 1st in Melbourne is `23:00` on the last of the previous
      // month in UTC. Naive bounds drop it, and it reads in production as
      // "sometimes an event is missing from the first day of the month".
      const { first, next } = nextMonthBounds(MELBOURNE);
      const event = await createEvent({
        startLocal: `${first} 09:00`,
        frequency: 'none',
      });

      const listed = await auth(
        request(server()).get('/calendar/events/occurrences'),
      )
        .query({ from: first, to: next, timezone: MELBOURNE })
        .expect(200);

      const mine = listed.body.filter(
        (o: { eventId: string }) => o.eventId === event.id,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].startLocal).toBe(`${first} 09:00:00`);
      // ...and the instant really does fall on the previous UTC day.
      expect(new Date(mine[0].startsAt).getUTCDate()).not.toBe(1);
    });
  });

  describe('materialization', () => {
    it('expands the horizon and schedules a reminder per occurrence', async () => {
      const startLocal = localStringIn(MELBOURNE, 3 * 86_400_000);
      const event = await createEvent({
        startLocal,
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [900_000],
      });

      expect(await occurrencesOf(event.id)).toHaveLength(3);
      const jobs = await jobsOf(event.id);
      expect(jobs).toHaveLength(3);
      expect(jobs.every((j) => j.status === 'pending')).toBe(true);
      expect(jobs.every((j) => j.eventVersion === 1)).toBe(true);
    });

    it('is idempotent — re-expanding an unchanged event inserts nothing', async () => {
      // Occurrences collide on `(event_id, original_start)`, jobs on
      // `dedupe_key`. Without both, the nightly sweep would fan out.
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [900_000],
      });
      const before = await jobsOf(event.id);

      await scheduler.runMaterialize();

      expect(await occurrencesOf(event.id)).toHaveLength(3);
      expect(await jobsOf(event.id)).toHaveLength(before.length);
    });
  });

  describe('editing', () => {
    it('bumps the version and replaces the future work in one transaction', async () => {
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [900_000],
      });
      const before = await jobsOf(event.id);
      expect(before.length).toBeGreaterThan(0);

      const updated = await auth(
        request(server()).patch(`/calendar/events/${event.id}`),
      )
        .send({ title: 'Renamed standup' })
        .expect(200);

      expect(updated.body.version).toBe(2);
      const after = await jobsOf(event.id);
      // Same count, different rows: the old ones were deleted and re-expanded
      // at the new version, so nothing is left carrying a stale copy.
      expect(after).toHaveLength(before.length);
      expect(after.every((j) => j.eventVersion === 2)).toBe(true);
    });

    it('cancels the series without hunting down its jobs', async () => {
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [900_000],
      });
      await auth(request(server()).post(`/calendar/events/${event.id}/cancel`))
        .send({})
        .expect(201);

      expect(await jobsOf(event.id)).toHaveLength(0);
      const rows = await occurrencesOf(event.id);
      expect(rows.every((r) => r.status === 'cancelled')).toBe(true);
    });
  });

  describe('single-instance override', () => {
    it('survives a re-expansion because its identity never changes', async () => {
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [900_000],
      });
      const [first] = await occurrencesOf(event.id);
      const movedTo = first.startLocal.replace(/ \d{2}:/, ' 15:');

      const moved = await auth(
        request(server()).patch(`/calendar/occurrences/${first.id}`),
      )
        .send({ startLocal: movedTo })
        .expect(200);
      expect(moved.body.isOverride).toBe(true);
      // RECURRENCE-ID is untouched — that is what makes the next line true.
      expect(new Date(moved.body.originalStart).toISOString()).toBe(
        first.originalStart.toISOString(),
      );

      await scheduler.runMaterialize();

      const rows = await occurrencesOf(event.id);
      expect(rows).toHaveLength(3);
      const still = rows.find((r) => r.id === first.id)!;
      expect(still.startLocal).toBe(movedTo);
      expect(still.isOverride).toBe(true);
    });

    it('keeps its reminders when the series is edited', async () => {
      // Regression: the edit deletes the event's future pending jobs, and
      // re-expansion only schedules work for occurrences it INSERTS — an
      // override already exists, so it collided and got nothing back. Editing
      // a series silently stripped the reminders off every personalised
      // instance, which is both the least expected outcome and the hardest to
      // notice.
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [3_600_000],
      });
      const [first] = await occurrencesOf(event.id);
      await auth(request(server()).patch(`/calendar/occurrences/${first.id}`))
        .send({ title: 'Pinned' })
        .expect(200);

      await auth(request(server()).patch(`/calendar/events/${event.id}`))
        .send({ title: 'Edited' })
        .expect(200);

      const pending = (await jobsOf(event.id)).filter(
        (j) => j.occurrenceId === first.id && j.status === 'pending',
      );
      expect(pending).toHaveLength(1);
      expect(pending[0].eventVersion).toBe(2);
    });
  });

  describe('the loop', () => {
    it('claims a due job, runs it, and writes exactly one outbox row', async () => {
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'none',
        reminderOffsetsMs: [],
      });
      const [occurrence] = await occurrencesOf(event.id);
      await scheduler.schedule({
        kind: 'event_reminder',
        occurrenceId: occurrence.id,
        runAt: new Date(Date.now() - 1_000),
        dedupeKey: `e2e:${stamp}:due`,
        payload: { offsetMs: 900_000 },
      });

      const tick = await scheduler.runTick();
      expect(tick.done).toBeGreaterThanOrEqual(1);

      const [job] = await db
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.dedupeKey, `e2e:${stamp}:due`));
      expect(job.status).toBe('done');
      // Incremented at CLAIM time, which is what dead-letters a poison job.
      expect(job.attempts).toBe(1);

      const sent = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            eq(
              notifications.dedupeKey,
              `calendar.event_reminder:${occurrence.id}:900000:${userId}`,
            ),
          ),
        );
      expect(sent).toHaveLength(1);
    });

    it('drops a job whose event has moved on', async () => {
      // The property the whole design exists for: the job row is a reminder
      // that something MIGHT need doing, and the truth is re-read at execution.
      //
      // Scheduled against an OVERRIDE, because that is the occurrence an edit
      // preserves: a generated one is deleted and re-expanded, so its jobs
      // cascade away instead of living long enough to be found stale.
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'daily',
        count: 3,
        reminderOffsetsMs: [],
      });
      const [first] = await occurrencesOf(event.id);
      await auth(request(server()).patch(`/calendar/occurrences/${first.id}`))
        .send({ title: 'Pinned' })
        .expect(200);

      await scheduler.schedule({
        kind: 'event_reminder',
        occurrenceId: first.id,
        runAt: new Date(Date.now() - 1_000),
        dedupeKey: `e2e:${stamp}:stale`,
        payload: { offsetMs: 0 },
      });

      await auth(request(server()).patch(`/calendar/events/${event.id}`))
        .send({ title: 'Edited after scheduling' })
        .expect(200);

      await scheduler.runTick();

      const [job] = await db
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.dedupeKey, `e2e:${stamp}:stale`));
      expect(job.status).toBe('skipped');
      expect(job.lastError).toMatch(/stale/);
    });

    it('returns an abandoned claim to the queue', async () => {
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'none',
        reminderOffsetsMs: [],
      });
      const [occurrence] = await occurrencesOf(event.id);
      const job = (await scheduler.schedule({
        kind: 'event_reminder',
        occurrenceId: occurrence.id,
        runAt: new Date(Date.now() + 3_600_000),
        dedupeKey: `e2e:${stamp}:abandoned`,
        payload: {},
      }))!;

      // What a process that died mid-handler leaves behind.
      await db.execute(sql`
        UPDATE scheduled_job
        SET status = 'claimed', attempts = 1,
            lease_expires_at = now() - interval '1 minute'
        WHERE id = ${job.id}
      `);

      const reaped = await scheduler.runReap();
      expect(reaped.requeued).toBeGreaterThanOrEqual(1);
      expect(
        (
          await db
            .select()
            .from(scheduledJobs)
            .where(eq(scheduledJobs.id, job.id))
        )[0].status,
      ).toBe('pending');
    });

    it('dead-letters an abandoned claim with no attempts left', async () => {
      // Closes the poison-job loop: without this, a handler that kills the
      // worker every time is resurrected by the reaper forever.
      const event = await createEvent({
        startLocal: localStringIn(MELBOURNE, 3 * 86_400_000),
        frequency: 'none',
        reminderOffsetsMs: [],
      });
      const [occurrence] = await occurrencesOf(event.id);
      const job = (await scheduler.schedule({
        kind: 'event_reminder',
        occurrenceId: occurrence.id,
        runAt: new Date(Date.now() + 3_600_000),
        dedupeKey: `e2e:${stamp}:poison`,
        payload: {},
      }))!;

      await db.execute(sql`
        UPDATE scheduled_job
        SET status = 'claimed', attempts = max_attempts,
            lease_expires_at = now() - interval '1 minute'
        WHERE id = ${job.id}
      `);

      const reaped = await scheduler.runReap();
      expect(reaped.deadLettered).toBeGreaterThanOrEqual(1);
      const [row] = await db
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.id, job.id));
      expect(row.status).toBe('dead');

      // ...and an operator can put it back with a fresh budget.
      const requeued = await scheduler.requeueDead(job.id);
      expect(requeued).toMatchObject({ status: 'pending', attempts: 0 });
    });
  });

  describe('the in-process seam', () => {
    // What another module consumes: register a handler, schedule durable work
    // with no calendar behind it, cancel it when the work stops mattering.
    const KIND = 'e2e.probe';
    let ran: Array<{ subjectId: string | null; hadCalendar: boolean }>;

    beforeAll(() => {
      ran = [];
      app
        .get(ScheduledJobHandlerRegistry)
        .register(KIND, ({ job, calendar }) => {
          ran.push({
            subjectId: job.subjectId,
            hadCalendar: calendar !== null,
          });
          return Promise.resolve();
        });
    });

    it('runs standalone work and tells the handler there is no calendar', async () => {
      const subjectId = randomUUID();
      await scheduler.schedule({
        kind: KIND,
        runAt: new Date(Date.now() - 1_000),
        dedupeKey: `e2e:${stamp}:standalone`,
        subject: { type: 'e2e_subject', id: subjectId },
        payload: { note: 'hello' },
      });

      await scheduler.runTick();

      expect(ran).toContainEqual({ subjectId, hadCalendar: false });
      const [job] = await db
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.dedupeKey, `e2e:${stamp}:standalone`));
      expect(job).toMatchObject({
        status: 'done',
        eventId: null,
        occurrenceId: null,
        eventVersion: null,
        subjectType: 'e2e_subject',
      });
    });

    it('cancels every unfired job about one subject', async () => {
      const subjectId = randomUUID();
      for (const stage of ['first', 'second']) {
        await scheduler.schedule({
          kind: KIND,
          runAt: new Date(Date.now() + 3_600_000),
          dedupeKey: `e2e:${stamp}:${subjectId}:${stage}`,
          subject: { type: 'e2e_subject', id: subjectId },
        });
      }
      expect(await scheduler.jobsFor('e2e_subject', subjectId)).toHaveLength(2);

      await expect(scheduler.cancelFor('e2e_subject', subjectId)).resolves.toBe(
        2,
      );
      expect(await scheduler.jobsFor('e2e_subject', subjectId)).toHaveLength(0);
    });

    it('cancels by the key the work was booked under', async () => {
      const key = `e2e:${stamp}:cancel-one`;
      await scheduler.schedule({
        kind: KIND,
        runAt: new Date(Date.now() + 3_600_000),
        dedupeKey: key,
      });
      await expect(scheduler.cancel(key)).resolves.toBe(true);
      // Already gone: the normal race, not an error.
      await expect(scheduler.cancel(key)).resolves.toBe(false);
    });

    it('refuses a kind no handler will ever run', async () => {
      await expect(
        scheduler.schedule({
          kind: 'e2e.never-registered',
          runAt: new Date(),
          dedupeKey: `e2e:${stamp}:orphan`,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.SCHEDULER_HANDLER_NOT_REGISTERED,
      });
      expect(await scheduler.findByDedupeKey(`e2e:${stamp}:orphan`)).toBeNull();
    });

    it('exposes the jobs for a subject over the admin API', async () => {
      const subjectId = randomUUID();
      await scheduler.schedule({
        kind: KIND,
        runAt: new Date(Date.now() + 3_600_000),
        dedupeKey: `e2e:${stamp}:admin-subject`,
        subject: { type: 'e2e_subject', id: subjectId },
      });
      const listed = await auth(
        request(server()).get(
          `/scheduler/subjects/e2e_subject/${subjectId}/jobs`,
        ),
      ).expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].kind).toBe(KIND);
    });
  });

  describe('operating it', () => {
    it('reports the counters worth alerting on', async () => {
      const status = await auth(
        request(server()).get('/scheduler/status'),
      ).expect(200);
      expect(status.body).toMatchObject({
        pending: expect.any(Number),
        overdue5m: expect.any(Number),
        inFlight: expect.any(Number),
        dead: expect.any(Number),
        degraded: expect.any(Boolean),
      });
      // The dispatcher must have something behind every kind it may claim.
      expect(status.body.registeredKinds).toContain('event_reminder');
    });

    it('keeps the admin surface admin-only', async () => {
      await request(server()).get('/scheduler/status').expect(401);
    });
  });
});

/**
 * A local wall-clock string `offsetMs` from now, in `timeZone`.
 *
 * Tests that need "in the future" cannot hardcode a date — they would start
 * failing the day the materialization horizon moves past it, which is the
 * first thing that went wrong when this file was written.
 */
function localStringIn(timeZone: string, offsetMs: number): string {
  return `${isoDateIn(timeZone, Date.now() + offsetMs)} ${hourIn(timeZone, Date.now() + offsetMs)}:00`;
}

/** `YYYY-MM-DD` as read in `timeZone` at `instantMs`. */
function isoDateIn(timeZone: string, instantMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instantMs));
}

function hourIn(timeZone: string, instantMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
  }).format(new Date(instantMs));
}

/** The first and last-plus-one days of next month, as local dates. */
function nextMonthBounds(timeZone: string): { first: string; next: string } {
  const today = isoDateIn(timeZone, Date.now());
  const [year, month] = today.split('-').map(Number);
  const roll = (y: number, m: number) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
  const [fy, fm] = roll(year, month);
  const [ny, nm] = roll(fy, fm);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    first: `${fy}-${pad(fm)}-01`,
    next: `${ny}-${pad(nm)}-01`,
  };
}

/**
 * The next instant within `days` at which `timeZone`'s UTC offset changes, or
 * null if there is none.
 *
 * Read from `Intl` directly rather than through the module under test, so the
 * fixture cannot agree with a bug in the code it is checking. Starts three days
 * out so the event it anchors is still inside the horizon.
 */
function nextTransition(timeZone: string, days: number): Date | null {
  const from = Date.now() + 3 * 86_400_000;
  let previous = offsetMinutes(new Date(from), timeZone);
  for (let t = from; t < Date.now() + days * 86_400_000; t += 3_600_000) {
    const current = offsetMinutes(new Date(t), timeZone);
    if (current !== previous) return new Date(t);
    previous = current;
  }
  return null;
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}
