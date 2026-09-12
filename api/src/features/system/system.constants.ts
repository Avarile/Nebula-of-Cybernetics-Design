import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

export const SYSTEM_RETENTION_QUEUE = QUEUE_NAMES.systemRetention;
export const RETENTION_SWEEP_JOB = 'retention-sweep';
export const RETENTION_SCHEDULER_ID = 'retention-sweep-scheduler';

/** How often the retention sweep runs. */
export const RETENTION_EVERY_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Rows deleted per statement, and statements per policy per tick.
 *
 * Bounded on purpose. An unbounded `DELETE` on a feed table holds locks for as
 * long as it runs, and a purge that stalls `activity_log` for a minute is worse
 * than one that takes an hour: the sweep is background work, the table is on
 * the request path.
 */
export const RETENTION_BATCH_SIZE = 1_000;
export const RETENTION_MAX_BATCHES_PER_RUN = 50;
