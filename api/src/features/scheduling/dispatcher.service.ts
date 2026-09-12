import { hostname } from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withTimeout } from '../../common/with-timeout';
import type { SchedulingConfig } from '../../config/configurations/scheduling.config';
import type { ScheduledJobRow } from '../../infrastructure/database/schema/calendar.schema';
import {
  ScheduledJobHandlerRegistry,
  type ScheduledJobContext,
} from '../../infrastructure/scheduling/job-handler.registry';
import { CalendarRepository } from './calendar.repository';
import { backoffMs } from './scheduling.constants';
import { SchedulingRepository } from './scheduling.repository';

export type JobOutcome = 'done' | 'skipped' | 'failed';

export interface TickResult {
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
  /** True when the tick ran out of time with work still due. */
  budgetExhausted: boolean;
  durationMs: number;
}

/**
 * The loop.
 *
 * Claim a batch with a lease, run it with bounded concurrency **re-reading the
 * event to check for staleness**, record `done` / `skipped` / failed-with-
 * backoff. Repeat until the batch comes back empty or the tick budget is spent.
 *
 * The staleness re-read is the load-bearing part, and the reason this design
 * beats putting the reminder in a queue. A job row says only "something might
 * need doing at 09:00"; what actually needs doing is whatever `calendar_event`
 * says NOW. So editing an event never has to reconcile scheduled work — bump
 * the version and every job created against the old one drops itself. A queued
 * message carries a copy of the intent, and there is no cheap way to invalidate
 * a copy.
 */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);
  private readonly config: SchedulingConfig;
  /** Recorded on the claim, so a stuck lease names the process holding it. */
  private readonly instanceId: string;

  constructor(
    private readonly jobs: SchedulingRepository,
    private readonly calendar: CalendarRepository,
    private readonly handlers: ScheduledJobHandlerRegistry,
    config: ConfigService,
  ) {
    this.config = config.getOrThrow<SchedulingConfig>('scheduling');
    this.instanceId = `${hostname()}:${process.pid}`.slice(0, 120);
  }

  /**
   * One poll.
   *
   * Bounded by `tickBudgetMs`, which sits below the cron interval so a backlog
   * cannot make ticks overlap and start competing with themselves for the same
   * rows and the same connections.
   */
  async tick(): Promise<TickResult> {
    const startedAt = Date.now();
    const deadline = startedAt + this.config.tickBudgetMs;
    const result: TickResult = {
      claimed: 0,
      done: 0,
      skipped: 0,
      failed: 0,
      budgetExhausted: false,
      durationMs: 0,
    };

    while (Date.now() < deadline) {
      const batch = await this.jobs.claimDue(
        this.config.batchSize,
        this.config.leaseSeconds,
        this.instanceId,
      );
      if (batch.length === 0) break;
      result.claimed += batch.length;

      for (const outcome of await this.runBatch(batch)) {
        if (outcome === 'done') result.done += 1;
        else if (outcome === 'skipped') result.skipped += 1;
        else result.failed += 1;
      }

      // A short batch means the due queue is drained; anything else and there
      // is more waiting, so go round again if the budget allows.
      if (batch.length < this.config.batchSize) break;
      if (Date.now() >= deadline) result.budgetExhausted = true;
    }

    result.durationMs = Date.now() - startedAt;
    if (result.claimed > 0) {
      this.logger.log(
        `Scheduler tick: ${result.done} done, ${result.skipped} skipped, ` +
          `${result.failed} failed in ${result.durationMs}ms` +
          (result.budgetExhausted ? ' (budget exhausted — backlog)' : ''),
      );
    }
    return result;
  }

  /**
   * Run a claimed batch with at most `concurrency` in flight.
   *
   * The ceiling is held against the pg pool, not chosen for elegance: the
   * dispatcher can hold `concurrency` connections at once, and undersizing
   * `DATABASE_POOL_MAX` is the usual way a table-based scheduler
   * "mysteriously" degrades API latency.
   */
  private async runBatch(batch: ScheduledJobRow[]): Promise<JobOutcome[]> {
    const outcomes: JobOutcome[] = new Array<JobOutcome>(batch.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let index = next++; index < batch.length; index = next++) {
        outcomes[index] = await this.execute(batch[index]);
      }
    };
    const width = Math.max(1, Math.min(this.config.concurrency, batch.length));
    await Promise.all(Array.from({ length: width }, worker));
    return outcomes;
  }

  /**
   * Run one job, having first re-read the truth it was scheduled against.
   *
   * Every early return is `skipped`, never `failed`: none of them is an error,
   * and counting a cancelled meeting as a failure is how a real failure gets
   * lost in the noise.
   */
  async execute(job: ScheduledJobRow): Promise<JobOutcome> {
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      // Never silently "succeed" — an unhandled kind means work is piling up
      // while the metrics look clean. `SchedulingService.schedule` refuses to
      // create one of these, so reaching here means a handler was REMOVED
      // (a module disabled, a rename half-landed) rather than never added.
      this.logger.warn(
        `No handler registered for scheduled job kind "${job.kind}" — skipping ${job.id}`,
      );
      await this.jobs.markSkipped(job.id, `no handler for kind "${job.kind}"`);
      return 'skipped';
    }

    const resolved = await this.resolveCalendar(job);
    if (resolved.skip) {
      await this.jobs.markSkipped(job.id, resolved.skip);
      return 'skipped';
    }

    try {
      // Capped below the lease: a handler that hangs must still end before the
      // reaper decides the job was abandoned, or the same work runs twice.
      await withTimeout(
        handler({ job, calendar: resolved.calendar }),
        this.config.handlerTimeoutMs,
      );
      await this.jobs.markDone(job.id);
      return 'done';
    } catch (error) {
      return this.recordFailure(job, error);
    }
  }

  /**
   * Re-read the truth a calendar-backed job was scheduled against.
   *
   * A job with no `occurrenceId` is standalone — another module booked it, and
   * there is no rule for it to be stale against, so there is nothing to check
   * here. That is not a weaker guarantee: the handler still re-reads whatever
   * `subjectType`/`subjectId` points at, because only that module knows what
   * "still wanted" means for an invoice or a sync.
   *
   * Returns a `skip` reason, or the calendar pair to hand the handler. Every
   * skip reason is a correct outcome, never an error — counting a cancelled
   * meeting as a failure is how a real failure gets lost in the noise.
   */
  private async resolveCalendar(
    job: ScheduledJobRow,
  ): Promise<{ skip?: string; calendar: ScheduledJobContext['calendar'] }> {
    if (!job.eventId || !job.occurrenceId) return { calendar: null };

    const event = await this.calendar.findById(job.eventId);
    if (!event || event.isDeleted) {
      return { skip: 'event deleted', calendar: null };
    }
    if (event.status === 'cancelled') {
      return { skip: 'event cancelled', calendar: null };
    }
    if (event.version !== job.eventVersion) {
      // The edit that bumped the version already scheduled replacements.
      return {
        skip: `stale: scheduled against v${job.eventVersion}, event is v${event.version}`,
        calendar: null,
      };
    }

    const occurrence = await this.calendar.findOccurrence(job.occurrenceId);
    if (!occurrence) {
      return { skip: 'occurrence deleted', calendar: null };
    }
    if (occurrence.status === 'cancelled') {
      return { skip: 'occurrence cancelled', calendar: null };
    }
    return { calendar: { event, occurrence } };
  }

  private async recordFailure(
    job: ScheduledJobRow,
    error: unknown,
  ): Promise<'failed'> {
    const message = error instanceof Error ? error.message : String(error);
    // `attempts` was incremented at claim time, so this is the count INCLUDING
    // the attempt that just failed.
    const exhausted = job.attempts >= job.maxAttempts;
    const retryAt = exhausted
      ? null
      : new Date(
          Date.now() +
            backoffMs(
              job.attempts,
              this.config.backoffBaseMs,
              this.config.backoffCapMs,
            ),
        );
    await this.jobs.markFailed(job.id, message, retryAt);
    if (exhausted) {
      this.logger.error(
        `Scheduled job ${job.id} (${job.kind}) dead-lettered after ` +
          `${job.attempts} attempt(s): ${message}`,
      );
    } else {
      this.logger.warn(
        `Scheduled job ${job.id} (${job.kind}) failed on attempt ` +
          `${job.attempts}, retrying at ${retryAt!.toISOString()}: ${message}`,
      );
    }
    return 'failed';
  }
}
