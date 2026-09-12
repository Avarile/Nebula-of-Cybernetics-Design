import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { files } from './file.schema';
import { imapConfigs } from './system.schema';

/** One address as parsed from a message header. */
export interface EmailAddress {
  address: string;
  name: string | null;
}

/**
 * A durably persisted inbound message. Postgres is the source of truth; Meili is
 * a rebuildable read model. Never hard-deleted (soft-delete = archive retention).
 * Stable identity is (accountId, mailbox, uidValidity, uid).
 */
export const emailMessages = pgTable(
  'email_messages',
  {
    ...baseColumns,
    accountId: uuid('account_id')
      .notNull()
      .references(() => imapConfigs.id),
    mailbox: varchar('mailbox', { length: 255 }).notNull().default('INBOX'),
    /**
     * IMAP UID. `bigint`, not `integer`: UIDs are unsigned 32-bit and run to
     * 4,294,967,295, while a Postgres `integer` stops at 2,147,483,647. A
     * long-lived mailbox does cross that, and the insert then fails with a
     * numeric overflow.
     */
    uid: bigint('uid', { mode: 'number' }).notNull(),
    uidValidity: bigint('uid_validity', { mode: 'number' }).notNull(),
    messageId: varchar('message_id', { length: 998 }),
    inReplyTo: varchar('in_reply_to', { length: 998 }),
    references: text('references'),
    threadId: varchar('thread_id', { length: 998 }),
    fromAddress: varchar('from_address', { length: 320 }).notNull().default(''),
    fromName: varchar('from_name', { length: 255 }),
    toAddresses: jsonb('to_addresses')
      .$type<EmailAddress[]>()
      .notNull()
      .default([]),
    ccAddresses: jsonb('cc_addresses')
      .$type<EmailAddress[]>()
      .notNull()
      .default([]),
    subject: text('subject').notNull().default(''),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    snippet: varchar('snippet', { length: 280 }).notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    bodyHtml: text('body_html'),
    sizeBytes: integer('size_bytes'),
    seen: boolean('seen').notNull().default(false),
    flagged: boolean('flagged').notNull().default(false),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    rawFileId: uuid('raw_file_id').references(() => files.id),
  },
  (t) => [
    uniqueIndex('email_messages_identity_idx')
      .on(t.accountId, t.mailbox, t.uidValidity, t.uid)
      .where(sql`${t.isDeleted} = false`),
    index('email_messages_list_idx').on(t.accountId, t.mailbox, t.receivedAt),
    index('email_messages_message_id_idx').on(t.messageId),
    index('email_messages_thread_idx').on(t.threadId),
    index('email_messages_seen_idx').on(t.accountId, t.seen),
  ],
);

/** Join from a message to its MinIO-backed attachment bytes (the `files` table). */
export const emailAttachments = pgTable(
  'email_attachments',
  {
    ...baseColumns,
    emailId: uuid('email_id')
      .notNull()
      .references(() => emailMessages.id),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    filename: varchar('filename', { length: 512 }),
    contentType: varchar('content_type', { length: 255 }).notNull(),
    size: integer('size').notNull(),
    contentId: varchar('content_id', { length: 255 }),
    inline: boolean('inline').notNull().default(false),
  },
  (t) => [index('email_attachments_email_idx').on(t.emailId)],
);

/** Per-(account, mailbox) incremental-sync cursor. */
export const emailSyncState = pgTable(
  'email_sync_state',
  {
    ...baseColumns,
    accountId: uuid('account_id')
      .notNull()
      .references(() => imapConfigs.id),
    mailbox: varchar('mailbox', { length: 255 }).notNull().default('INBOX'),
    uidValidity: bigint('uid_validity', { mode: 'number' }),
    lastSeenUid: integer('last_seen_uid').notNull().default(0),
    lastSyncStartedAt: timestamp('last_sync_started_at', {
      withTimezone: true,
    }),
    lastSyncFinishedAt: timestamp('last_sync_finished_at', {
      withTimezone: true,
    }),
    lastStatus: varchar('last_status', { length: 50 }),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('email_sync_state_account_mailbox_idx')
      .on(t.accountId, t.mailbox)
      .where(sql`${t.isDeleted} = false`),
  ],
);

export type EmailMessageRow = typeof emailMessages.$inferSelect;
export type NewEmailMessageRow = typeof emailMessages.$inferInsert;
export type EmailAttachmentRow = typeof emailAttachments.$inferSelect;
export type NewEmailAttachmentRow = typeof emailAttachments.$inferInsert;
export type EmailSyncStateRow = typeof emailSyncState.$inferSelect;
export type NewEmailSyncStateRow = typeof emailSyncState.$inferInsert;
