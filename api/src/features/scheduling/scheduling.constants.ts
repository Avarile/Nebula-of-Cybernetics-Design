import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

export const SCHEDULING_QUEUE = QUEUE_NAMES.scheduling;

/**
 * Three repeatables on one queue. BullMQ is used ONLY as the cron trigger here
 * — it carries no work item. The `scheduled_job` table remains the source of
 * truth, which is what makes the design survive a Redis flush, a redeploy, and
 * the day someone decides to put a real queue in front of the handlers.
 */
export const POLL_TICK_JOB = 'scheduler-tick';
export const REAP_JOB = 'scheduler-reap';
export const MATERIALIZE_JOB = 'scheduler-materialize';

/** Stable ids, so re-registering on boot updates in place rather than
 * orphaning repeatables in Redis. */
export const POLL_TICK_SCHEDULER_ID = 'scheduler-tick-scheduler';
export const REAP_SCHEDULER_ID = 'scheduler-reap-scheduler';
export const MATERIALIZE_SCHEDULER_ID = 'scheduler-materialize-scheduler';

/**
 * Retry delay with **full jitter**: `random(0.5..1.0) x min(base x 2^n, cap)`.
 *
 * The jitter is not decoration. Without it a hundred jobs that failed against
 * the same downstream retry in lockstep and hammer it in synchronised waves
 * exactly as it comes back up — turning one outage into several.
 *
 * `random` is injectable so the spec can assert the bounds rather than the
 * distribution.
 */
export function backoffMs(
  attempts: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(baseMs * 2 ** Math.max(0, attempts - 1), capMs);
  return Math.round(exponential * (0.5 + random() * 0.5));
}

/** `event_reminder:{occurrenceId}:{offsetMs}` — makes re-expansion a no-op. */
export function reminderDedupeKey(
  occurrenceId: string,
  offsetMs: number,
): string {
  return `event_reminder:${occurrenceId}:${offsetMs}`;
}
