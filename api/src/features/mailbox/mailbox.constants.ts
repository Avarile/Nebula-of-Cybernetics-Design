import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

/** BullMQ queue that runs inbound-mail sync off the request path. */
export const MAILBOX_SYNC_QUEUE = QUEUE_NAMES.mailboxSync;

/** Job: pull new messages for one (accountId, mailbox) into the store. */
export const SYNC_MAILBOX_JOB = 'sync-mailbox';

/** The system-owned MeiliSearch collection inbound mail is indexed into. */
export const INBOUND_EMAIL_COLLECTION = 'inbound_email';

/** Shared BullMQ options for sync jobs: bounded retries, self-cleaning. */
export const SYNC_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

/** Job: re-index recent stored messages whose Meili document may be missing/stale. */
export const RECONCILE_MAILBOX_JOB = 'reconcile-mailbox';
/** How often the reconciliation sweep runs. */
export const RECONCILE_EVERY_MS = 6 * 60 * 60 * 1000; // 6h
/** Only reconcile messages received within this lookback window. */
export const RECONCILE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7d
/** Max messages re-persisted per sweep. */
export const RECONCILE_BATCH = 500;
