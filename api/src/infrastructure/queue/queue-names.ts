/**
 * Every BullMQ queue name in the application, in one place.
 *
 * Producer and consumer often live in different modules — `FileProcessorModule`
 * registers `document-ingest` as a producer specifically so it does not have to
 * import `DocumentIngestModule` (which imports it back). That breaks the cycle,
 * but it also means the queue name is the only thing holding the two halves
 * together, and a rename in one module compiles perfectly while silently
 * splitting the producer from its consumer.
 *
 * Importing the name from here makes that impossible: there is one definition
 * to rename, and both sides move with it.
 */
export const QUEUE_NAMES = {
  fileProcessing: 'file-processing',
  documentIngest: 'document-ingest',
  searchIndexing: 'search-indexing',
  mailboxSync: 'mailbox-sync',
  agentRun: 'agent-run',
  authCleanup: 'auth-cleanup',
  systemRetention: 'system-retention',
  notificationSend: 'notification-send',
  scheduling: 'scheduling',
  projectProjection: 'project-projection',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
