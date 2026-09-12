import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

/** Queue carrying the periodic auth-table cleanup sweep. */
export const AUTH_CLEANUP_QUEUE = QUEUE_NAMES.authCleanup;

/** Job: reclaim expired sessions and consumed/expired reset codes. */
export const AUTH_CLEANUP_JOB = 'auth-cleanup';

/** Stable scheduler id — `upsertJobScheduler` is keyed by it and idempotent. */
export const AUTH_CLEANUP_SCHEDULER_ID = 'auth-cleanup';
