import type { JobsOptions } from 'bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

/** The queue that carries per-task search projection off the request path. */
export const PROJECT_PROJECTION_QUEUE = QUEUE_NAMES.projectProjection;

/**
 * Re-index a project and every task under it.
 *
 * A membership change rewrites the scope array on the project AND on all of its
 * tasks, so one member added to a thousand-task project is a thousand index
 * writes. Doing that inline held the request — and a pooled connection — for the
 * duration; measured at ~32 ms per task.
 */
export const REPROJECT_PROJECT_JOB = 'reproject-project-tasks';

/** Drop a deleted project's tasks from the index. */
export const DEPROJECT_PROJECT_JOB = 'deproject-project-tasks';

/**
 * Retry a few times, then leave it. The search reconciliation sweep already
 * repairs records stuck outside `INDEXED`, so a job lost here is recovered
 * rather than silently dropped — the same reasoning as `INDEXING_JOB_OPTS`.
 */
export const PROJECTION_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
};
