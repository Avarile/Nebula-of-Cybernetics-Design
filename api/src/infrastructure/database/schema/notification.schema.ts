import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { contacts } from './contact.schema';
import { users } from './identity.schema';
import { priorityLevel, projects } from './project.schema';
import { smtpConfigs } from './system.schema';

/**
 * Email is the only channel, per requirement. The enum still exists with one
 * value so adding `in_app` or `webhook` later is a value plus a transport, not a
 * migration of every table in this file.
 */
export const notificationChannel = pgEnum('notification_channel', ['email']);

export const notificationStatus = pgEnum('notification_status', [
  'pending',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'suppressed',
  'cancelled',
]);

export const notificationFrequency = pgEnum('notification_frequency', [
  'immediate',
  'hourly',
  'daily',
  'weekly',
  'off',
]);

export const suppressionReason = pgEnum('suppression_reason', [
  'hard_bounce',
  'soft_bounce_repeated',
  'complaint',
  'unsubscribe',
  'manual',
  'invalid',
]);

/** Subjects a notification can deep-link to. */
export const notificationEntityType = pgEnum('notification_entity_type', [
  'project',
  'task',
  'goal',
  'milestone',
  'knowledge',
  'contact',
  'invoice',
  'budget',
  'user',
  'system',
  'event',
]);

/**
 * The stable catalog every preference and template keys off. A boot-time
 * assertion checks that each event key emitted in code resolves to a row here,
 * so a typo is a startup failure rather than an email nobody ever receives.
 */
export const notificationEventTypes = pgTable(
  'notification_event_types',
  {
    ...baseColumns,
    /** e.g. `task.assigned`, `knowledge.review_due`, `invoice.overdue`. */
    key: varchar('key', { length: 120 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 500 }),
    /** Groups the preferences screen. */
    category: varchar('category', { length: 60 }).notNull().default('system'),
    defaultEnabled: boolean('default_enabled').notNull().default(true),
    isDigestable: boolean('is_digestable').notNull().default(true),
    /**
     * Security and transactional mail a user may not switch off. Without this
     * flag an opt-out would silently disable password-reset delivery.
     */
    isMandatory: boolean('is_mandatory').notNull().default(false),
    defaultTemplateKey: varchar('default_template_key', { length: 120 }),
    isSystem: boolean('is_system').notNull().default(true),
  },
  (t) => [
    uniqueIndex('notification_event_types_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('notification_event_types_category_idx').on(t.category),
  ],
);

/**
 * Wording lives in data, so a copy change needs no deploy. Rendering is
 * logic-less substitution (`{{ variable }}`) on purpose: a template language
 * with loops and conditionals in a database row is a code path with no tests
 * and no review.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    ...baseColumns,
    key: varchar('key', { length: 120 }).notNull(),
    locale: varchar('locale', { length: 16 }).notNull().default('en'),
    channel: notificationChannel('channel').notNull().default('email'),
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 500 }),
    subjectTemplate: varchar('subject_template', { length: 500 }).notNull(),
    /** Always sent — mirrors `EmailMessage.text` being required. */
    bodyTextTemplate: text('body_text_template').notNull(),
    bodyHtmlTemplate: text('body_html_template'),
    /** Declared variables + JSON-Schema types, validated when the template is
     * saved AND when a notification is enqueued, so a renamed field surfaces at
     * save time rather than as a blank line in someone's inbox. */
    variables: jsonb('variables')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('notification_templates_key_idx')
      .on(t.key, t.locale, t.channel)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * Per-user, per-event opt-in state. A missing row means the event type's
 * `defaultEnabled` — rows are written only when a user changes something, so
 * signup does not fan out N x M rows.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => notificationEventTypes.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull().default('email'),
    enabled: boolean('enabled').notNull().default(true),
    frequency: notificationFrequency('frequency')
      .notNull()
      .default('immediate'),
    /** Local hours 0-23, interpreted in `user_profiles.timezone`. Deferral, not
     * suppression: a quiet-hours notification is scheduled, never dropped. */
    quietHoursStart: integer('quiet_hours_start'),
    quietHoursEnd: integer('quiet_hours_end'),
  },
  (t) => [
    uniqueIndex('notification_preferences_unique_idx')
      .on(t.userId, t.eventTypeId, t.channel)
      .where(sql`${t.isDeleted} = false`),
    index('notification_preferences_event_idx').on(t.eventTypeId, t.enabled),
  ],
);

/**
 * The outbox AND the history.
 *
 * The row is written in the SAME transaction as the business change it
 * announces, with `status = 'pending'`; a queue job drains it afterwards. Send
 * inside the transaction and a rollback still emails; send after commit and a
 * crash between the two loses it. This is the outbox pattern
 * `search_records.index_state` already implements for Meilisearch, reused here
 * rather than reinvented.
 *
 * Rendered bodies are NOT stored by default: `subject` + `bodyPreview` +
 * `payload` are enough to show history and re-render on demand, while full
 * bodies would put recipient-visible PII into a fast-growing table.
 */
export const notifications = pgTable(
  'notifications',
  {
    ...baseColumns,
    recipientUserId: uuid('recipient_user_id').references(() => users.id),
    /** Recipients can be contacts with no account. */
    recipientContactId: uuid('recipient_contact_id').references(
      () => contacts.id,
    ),
    /** Resolved and snapshotted at enqueue: a later address change must not
     * silently redirect a message already queued. */
    recipientEmail: varchar('recipient_email', { length: 320 }).notNull(),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => notificationEventTypes.id),
    templateId: uuid('template_id').references(() => notificationTemplates.id),
    channel: notificationChannel('channel').notNull().default('email'),
    subject: varchar('subject', { length: 500 }).notNull(),
    bodyPreview: varchar('body_preview', { length: 1000 }),
    /** Template variables — re-renders the message without storing it. */
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    entityType: notificationEntityType('entity_type'),
    entityId: uuid('entity_id'),
    /** Denormalized scope key, as in `activity_log`. */
    projectId: uuid('project_id').references(() => projects.id),
    status: notificationStatus('status').notNull().default('pending'),
    priority: priorityLevel('priority').notNull().default('medium'),
    /** Digest window or quiet-hours deferral. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 1000 }),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    /** Idempotency: `task.assigned:{taskId}:{userId}` cannot be delivered twice
     * by a retried job. */
    dedupeKey: varchar('dedupe_key', { length: 255 }),
    /** Rows sharing this collapse into one digest email. */
    digestGroupKey: varchar('digest_group_key', { length: 255 }),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_idx')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.isDeleted} = false`),
    /** The send sweep's exact predicate, partial so it holds only unsent rows. */
    index('notifications_sendable_idx')
      .on(t.scheduledFor)
      .where(sql`${t.status} IN ('pending', 'queued')`),
    index('notifications_recipient_idx').on(t.recipientUserId, t.createdAt),
    index('notifications_digest_idx')
      .on(t.digestGroupKey)
      .where(sql`${t.digestGroupKey} IS NOT NULL AND ${t.status} = 'pending'`),
    index('notifications_status_idx').on(t.status, t.createdAt),
    index('notifications_created_idx').on(t.createdAt), // retention sweep
  ],
);

/**
 * Per-attempt diagnostics, append-only. Split from `notifications` so the
 * outbox row stays narrow and hot while the history — which is what actually
 * grows — sits in its own table with its own retention.
 */
export const notificationDeliveryAttempts = pgTable(
  'notification_delivery_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: notificationStatus('status').notNull(),
    /** Which sender profile was used — decisive when one relay starts failing. */
    smtpConfigId: uuid('smtp_config_id').references(() => smtpConfigs.id),
    responseCode: varchar('response_code', { length: 20 }),
    responseMessage: varchar('response_message', { length: 1000 }),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('notification_delivery_attempts_notification_idx').on(
      t.notificationId,
      t.attemptNumber,
    ),
    index('notification_delivery_attempts_created_idx').on(t.createdAt),
  ],
);

/**
 * Checked before every send. Without it, one hard bounce retried daily is how a
 * sending domain gets blacklisted.
 *
 * A suppressed send records `status = 'suppressed'`, never `failed`: a
 * suppression is a correct outcome, and conflating the two hides real failures.
 * A mandatory event bypasses preferences but NEVER bypasses a hard bounce or a
 * complaint.
 */
export const notificationSuppressions = pgTable(
  'notification_suppressions',
  {
    ...baseColumns,
    email: varchar('email', { length: 320 }).notNull(), // lowercased
    reason: suppressionReason('reason').notNull(),
    /** Null suppresses everything; set suppresses one event type. */
    eventTypeId: uuid('event_type_id').references(
      () => notificationEventTypes.id,
    ),
    source: varchar('source', { length: 120 }),
    /** Soft bounces expire; hard bounces do not. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    note: varchar('note', { length: 500 }),
  },
  (t) => [
    uniqueIndex('notification_suppressions_email_idx')
      .on(t.email, t.eventTypeId)
      .where(sql`${t.isDeleted} = false`),
    index('notification_suppressions_lookup_idx').on(t.email),
  ],
);

export type NotificationEventTypeRow =
  typeof notificationEventTypes.$inferSelect;
export type NewNotificationEventTypeRow =
  typeof notificationEventTypes.$inferInsert;
export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplateRow =
  typeof notificationTemplates.$inferInsert;
export type NotificationPreferenceRow =
  typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferenceRow =
  typeof notificationPreferences.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type NotificationDeliveryAttemptRow =
  typeof notificationDeliveryAttempts.$inferSelect;
export type NewNotificationDeliveryAttemptRow =
  typeof notificationDeliveryAttempts.$inferInsert;
export type NotificationSuppressionRow =
  typeof notificationSuppressions.$inferSelect;
export type NewNotificationSuppressionRow =
  typeof notificationSuppressions.$inferInsert;
