import { registerAs } from '@nestjs/config';

/**
 * Namespaced scheduler config. Read directly from `process.env` with safe
 * defaults — these are operational tunables, not boot secrets, so the global
 * env schema stays unchanged (same reasoning as `mailbox.config.ts`).
 *
 * The interactions worth knowing before changing anything:
 *
 *  - `tickIntervalMs` is the latency floor. Reminders fire 0-10s late by
 *    design; nothing here buys sub-second precision.
 *  - `tickBudgetMs` must stay BELOW `tickIntervalMs`, or a backlog makes ticks
 *    overlap and the poller starts competing with itself.
 *  - `leaseSeconds` must EXCEED the slowest handler. Too short duplicates work
 *    (the reaper re-queues a job that is still running); too long delays
 *    recovery after a crash.
 *  - `concurrency` is held against the pg pool. Undersize `DATABASE_POOL_MAX`
 *    and the poller starves the HTTP handlers — the usual way a table-based
 *    scheduler "mysteriously" degrades API latency.
 */
export const schedulingConfig = registerAs('scheduling', () => ({
  /** How often the poller wakes. The scheduling latency floor. */
  tickIntervalMs: intEnv('SCHEDULER_TICK_INTERVAL_MS', 10_000),
  /** How often expired leases are returned to `pending`. */
  reapIntervalMs: intEnv('SCHEDULER_REAP_INTERVAL_MS', 60_000),
  /** Nightly expansion, as a cron pattern in the server's zone. */
  materializeCron: process.env.SCHEDULER_MATERIALIZE_CRON ?? '0 3 * * *',

  /** Claim lease. Must exceed the slowest handler. */
  leaseSeconds: intEnv('SCHEDULER_LEASE_SECONDS', 60),
  /** Wall-clock ceiling on one tick. Below `tickIntervalMs`, deliberately. */
  tickBudgetMs: intEnv('SCHEDULER_TICK_BUDGET_MS', 8_000),
  /** Jobs run at once. Must fit inside the pg pool alongside HTTP traffic. */
  concurrency: intEnv('SCHEDULER_CONCURRENCY', 10),
  /** Rows claimed per statement. */
  batchSize: intEnv('SCHEDULER_BATCH_SIZE', 100),
  /** Per-handler timeout. Kept under the lease so a hung handler still ends. */
  handlerTimeoutMs: intEnv('SCHEDULER_HANDLER_TIMEOUT_MS', 30_000),

  /** Attempts before a job dead-letters. Counted at claim, not at failure. */
  maxAttempts: intEnv('SCHEDULER_MAX_ATTEMPTS', 5),
  backoffBaseMs: intEnv('SCHEDULER_BACKOFF_BASE_MS', 30_000),
  backoffCapMs: intEnv('SCHEDULER_BACKOFF_CAP_MS', 30 * 60_000),

  /** The knob that bounds storage: how far ahead occurrences are expanded. */
  materializeHorizonDays: intEnv('SCHEDULER_HORIZON_DAYS', 90),
  /** Events expanded per materializer pass, so one run cannot stall. */
  materializeBatch: intEnv('SCHEDULER_MATERIALIZE_BATCH', 200),

  /** `overdue_5m` above this is the alert that matters. */
  overdueAlertThreshold: intEnv('SCHEDULER_OVERDUE_ALERT_THRESHOLD', 1),
}));

export type SchedulingConfig = ReturnType<typeof schedulingConfig>;

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}
