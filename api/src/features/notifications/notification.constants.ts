import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

export const NOTIFICATION_QUEUE = QUEUE_NAMES.notificationSend;
export const NOTIFICATION_SEND_JOB = 'notification-send';
export const NOTIFICATION_SCHEDULER_ID = 'notification-send-scheduler';

/** How often the drain sweep runs. */
export const NOTIFICATION_EVERY_MS = 60_000;

/** Rows claimed per tick. */
export const NOTIFICATION_BATCH = 100;

/**
 * Delivery attempts before a notification is abandoned.
 *
 * Backoff mirrors `search-indexing.processor`: a transient relay failure should
 * retry, a permanent one should stop rather than hammer the relay forever.
 */
export const MAX_SEND_ATTEMPTS = 5;

/** Exponential backoff, capped so a retry never sits for hours. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 30 * 60_000);
}
