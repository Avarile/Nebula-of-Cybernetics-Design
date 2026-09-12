import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  scheduledJobs,
  type NewScheduledJobRow,
  type ScheduledJobRow,
} from '../../infrastructure/database/schema/calendar.schema';

/** The numbers worth alerting on. */
export interface SchedulerHealth {
  pending: number;
  /**
   * Pending jobs more than five minutes late. **This is the alert that
   * matters** — non-zero means the poller is not keeping up, or is dead.
   */
  overdue5m: number;
  /** Claimed right now. Persistently non-zero means leases are held too long. */
  inFlight: number;
  /** Exhausted retries. Needs eyes. */
  dead: number;
  /** Observed scheduling lag, in seconds. Null when nothing is due. */
  oldestDueAgeSeconds: number | null;
}

export interface ReapResult {
  requeued: number;
  deadLettered: number;
}

/**
 * The poller's table.
 *
 * Every statement here is written against `scheduled_job_due_idx` — partial on
 * `status = 'pending'`, so it holds only unfired work while the table itself
 * grows forever. That is what keeps the poller's cost flat as history
 * accumulates.
 *
 * **The database clock is authoritative.** Due-ness, leases and the reaper all
 * compare against `now()` inside Postgres rather than a `Date` from the
 * application. With two clocks, a few seconds of drift between a replica and
 * the database turns "lease expired" into a coin toss and the reaper starts
 * re-queueing work that is still running.
 */
@Injectable()
export class SchedulingRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Schedule work. Duplicates are dropped on `dedupe_key`, which is what makes
   * re-expanding an unchanged event a no-op rather than a fan-out.
   */
  async insertJobs(
    rows: NewScheduledJobRow[],
    executor: DrizzleExecutor = this.db,
  ): Promise<ScheduledJobRow[]> {
    if (rows.length === 0) return [];
    return executor
      .insert(scheduledJobs)
      .values(rows)
      .onConflictDoNothing({ target: scheduledJobs.dedupeKey })
      .returning();
  }

  /**
   * Drop an event's future, unfired work.
   *
   * Only `pending` rows: a `claimed` job is mid-flight in another process, and
   * deleting it from underneath would race the handler. It does not need to be
   * deleted — it fails its own version check when it finishes claiming, which
   * is precisely why the version exists.
   */
  async deleteFuturePending(
    eventId: string,
    from: Date,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .delete(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.eventId, eventId),
          eq(scheduledJobs.status, 'pending'),
          gte(scheduledJobs.runAt, from),
        ),
      )
      .returning({ id: scheduledJobs.id });
    return rows.length;
  }

  /**
   * Cancel unfired work by its dedupe key.
   *
   * The counterpart to `SchedulingService.schedule` for a caller that knows
   * exactly what it booked. Only `pending` rows: a claimed job is running, and
   * deleting it from underneath the handler would race it.
   */
  async cancelByDedupeKey(
    dedupeKey: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .delete(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.dedupeKey, dedupeKey),
          eq(scheduledJobs.status, 'pending'),
        ),
      )
      .returning({ id: scheduledJobs.id });
    return rows.length > 0;
  }

  /**
   * Cancel every unfired job about one thing.
   *
   * "The invoice was paid, drop its chasers" is one statement rather than a
   * search, which is the reason `subject_type`/`subject_id` exist. Hits
   * `scheduled_job_subject_idx`.
   */
  async cancelBySubject(
    subjectType: string,
    subjectId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .delete(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.subjectType, subjectType),
          eq(scheduledJobs.subjectId, subjectId),
          eq(scheduledJobs.status, 'pending'),
        ),
      )
      .returning({ id: scheduledJobs.id });
    return rows.length;
  }

  /** Everything scheduled about one thing — the "why did this not fire?" query. */
  listBySubject(
    subjectType: string,
    subjectId: string,
    limit: number,
  ): Promise<ScheduledJobRow[]> {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.subjectType, subjectType),
          eq(scheduledJobs.subjectId, subjectId),
        ),
      )
      .orderBy(asc(scheduledJobs.runAt))
      .limit(limit);
  }

  async findByDedupeKey(dedupeKey: string): Promise<ScheduledJobRow | null> {
    const rows = await this.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.dedupeKey, dedupeKey))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Pending kinds nobody has registered a handler for — a boot-time warning. */
  async pendingKinds(): Promise<Array<{ kind: string; count: number }>> {
    const result = await this.db.execute<{ kind: string; count: string }>(sql`
      SELECT kind, count(*)::text AS count
      FROM ${scheduledJobs}
      WHERE status = 'pending'
      GROUP BY kind
    `);
    return result.rows.map((r) => ({ kind: r.kind, count: Number(r.count) }));
  }

  /**
   * Drop ONE occurrence's future, unfired work.
   *
   * Moving a single instance of a series must not disturb the reminders of
   * every other instance, which is what a delete scoped to the event would do.
   */
  async deleteFuturePendingForOccurrence(
    occurrenceId: string,
    from: Date,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .delete(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.occurrenceId, occurrenceId),
          eq(scheduledJobs.status, 'pending'),
          gte(scheduledJobs.runAt, from),
        ),
      )
      .returning({ id: scheduledJobs.id });
    return rows.length;
  }

  /**
   * Claim a batch, taking a lease.
   *
   * `FOR UPDATE SKIP LOCKED` is not optional even on a single instance:
   * "single instance" is only true between deploys. During a rolling restart
   * two processes poll concurrently for a few seconds and, without it, every
   * due reminder fires twice. The cost of the safety is one clause.
   *
   * `attempts` is incremented HERE, not on failure. A handler that segfaults
   * the worker still burns an attempt, so a poison job dead-letters instead of
   * taking the process down five times an hour forever.
   */
  async claimDue(
    limit: number,
    leaseSeconds: number,
    claimedBy: string,
  ): Promise<ScheduledJobRow[]> {
    const claimed = await this.db.execute<{ id: string }>(sql`
      UPDATE ${scheduledJobs}
      SET status = 'claimed',
          attempts = ${scheduledJobs}.attempts + 1,
          lease_expires_at = now() + make_interval(secs => ${leaseSeconds}::double precision),
          claimed_by = ${claimedBy},
          updated_at = now()
      WHERE id IN (
        SELECT id FROM ${scheduledJobs}
        WHERE status = 'pending'
          AND run_at <= now()
        ORDER BY run_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);
    const ids = claimed.rows.map((r) => r.id);
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(scheduledJobs)
      .where(inArray(scheduledJobs.id, ids))
      .orderBy(asc(scheduledJobs.runAt));
  }

  async markDone(id: string): Promise<void> {
    await this.db
      .update(scheduledJobs)
      .set({
        status: 'done',
        completedAt: new Date(),
        leaseExpiresAt: null,
        lastError: null,
      })
      .where(eq(scheduledJobs.id, id));
  }

  /**
   * Deliberately not run: stale version, cancelled event, no handler.
   *
   * A distinct terminal state from `failed`, because a skipped job is a correct
   * outcome and counting it as a failure hides the real ones.
   */
  async markSkipped(id: string, reason: string): Promise<void> {
    await this.db
      .update(scheduledJobs)
      .set({
        status: 'skipped',
        completedAt: new Date(),
        leaseExpiresAt: null,
        lastError: reason.slice(0, 1000),
      })
      .where(eq(scheduledJobs.id, id));
  }

  /**
   * Record a handler failure. `retryAt` null means retries are exhausted.
   *
   * Back to `pending` while retries remain, so the same sweep picks it up
   * again once the backoff has elapsed; `dead` is terminal.
   */
  async markFailed(
    id: string,
    error: string,
    retryAt: Date | null,
  ): Promise<void> {
    await this.db
      .update(scheduledJobs)
      .set({
        status: retryAt ? 'pending' : 'dead',
        runAt: retryAt ?? undefined,
        leaseExpiresAt: null,
        claimedBy: null,
        lastError: error.slice(0, 1000),
        completedAt: retryAt ? null : new Date(),
      })
      .where(eq(scheduledJobs.id, id));
  }

  /**
   * Return abandoned claims to the queue.
   *
   * The row a crashed process left behind stays `claimed` with a lease that
   * stops ticking; nothing has to be cleaned up BY the process that crashed,
   * which is the only kind of cleanup that can be relied on.
   *
   * Jobs whose attempts are already spent are dead-lettered instead of
   * re-queued — otherwise a handler that kills the worker every time would be
   * resurrected by the reaper forever, and the attempt counter would never
   * matter.
   */
  async reapExpiredLeases(): Promise<ReapResult> {
    const dead = await this.db.execute<{ id: string }>(sql`
      UPDATE ${scheduledJobs}
      SET status = 'dead',
          lease_expires_at = NULL,
          completed_at = now(),
          last_error = 'lease expired with no attempts remaining',
          updated_at = now()
      WHERE status = 'claimed'
        AND lease_expires_at < now()
        AND attempts >= max_attempts
      RETURNING id
    `);
    const requeued = await this.db.execute<{ id: string }>(sql`
      UPDATE ${scheduledJobs}
      SET status = 'pending',
          lease_expires_at = NULL,
          claimed_by = NULL,
          last_error = 'lease expired; requeued by reaper',
          updated_at = now()
      WHERE status = 'claimed'
        AND lease_expires_at < now()
      RETURNING id
    `);
    return { requeued: requeued.rows.length, deadLettered: dead.rows.length };
  }

  /**
   * Operational counters.
   *
   * A single aggregate over the whole table rather than five queries. It is a
   * sequential scan, bounded by the 30-day retention window — fine for an admin
   * endpoint and a scrape interval, not for a request hot path.
   */
  async health(): Promise<SchedulerHealth> {
    const result = await this.db.execute<{
      pending: string;
      overdue_5m: string;
      in_flight: string;
      dead: string;
      oldest_due_age_s: string | null;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending')::text AS pending,
        count(*) FILTER (
          WHERE status = 'pending' AND run_at < now() - interval '5 minutes'
        )::text AS overdue_5m,
        count(*) FILTER (WHERE status = 'claimed')::text AS in_flight,
        count(*) FILTER (WHERE status = 'dead')::text AS dead,
        extract(epoch from (
          now() - min(run_at) FILTER (WHERE status = 'pending' AND run_at <= now())
        ))::text AS oldest_due_age_s
      FROM ${scheduledJobs}
    `);
    const row = result.rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      overdue5m: Number(row?.overdue_5m ?? 0),
      inFlight: Number(row?.in_flight ?? 0),
      dead: Number(row?.dead ?? 0),
      oldestDueAgeSeconds:
        row?.oldest_due_age_s == null
          ? null
          : Math.round(Number(row.oldest_due_age_s)),
    };
  }

  listDead(limit: number): Promise<ScheduledJobRow[]> {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.status, 'dead'))
      .orderBy(desc(scheduledJobs.updatedAt))
      .limit(limit);
  }

  /** Put a dead-lettered job back, with its attempt budget restored. */
  async requeueDead(id: string, runAt: Date): Promise<ScheduledJobRow | null> {
    const rows = await this.db
      .update(scheduledJobs)
      .set({
        status: 'pending',
        attempts: 0,
        runAt,
        leaseExpiresAt: null,
        claimedBy: null,
        completedAt: null,
        lastError: null,
      })
      .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.status, 'dead')))
      .returning();
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<ScheduledJobRow | null> {
    const rows = await this.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Jobs for one occurrence — the admin "why did this not fire?" query. */
  listForOccurrence(occurrenceId: string): Promise<ScheduledJobRow[]> {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.occurrenceId, occurrenceId))
      .orderBy(asc(scheduledJobs.runAt));
  }

  /**
   * Bounded delete for the retention sweep. Terminal rows only — deleting a
   * `pending` or `claimed` row would silently cancel scheduled work.
   */
  async purgeTerminalOlderThan(cutoff: Date, limit: number): Promise<number> {
    const doomed = await this.db
      .select({ id: scheduledJobs.id })
      .from(scheduledJobs)
      .where(
        and(
          lt(scheduledJobs.createdAt, cutoff),
          inArray(scheduledJobs.status, ['done', 'skipped', 'dead']),
        ),
      )
      .limit(limit);
    if (doomed.length === 0) return 0;
    await this.db.delete(scheduledJobs).where(
      inArray(
        scheduledJobs.id,
        doomed.map((d) => d.id),
      ),
    );
    return doomed.length;
  }
}
