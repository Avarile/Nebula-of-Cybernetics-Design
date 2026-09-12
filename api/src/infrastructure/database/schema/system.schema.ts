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
import { users } from './identity.schema';

/** How an integration credential authenticates to a 3rd-party service. */
export const credentialKind = pgEnum('credential_kind', [
  'api_key',
  'oauth2',
  'basic',
  'bearer',
]);

/** Value type of a generic system setting (drives typed reads + validation). */
export const settingType = pgEnum('setting_type', [
  'string',
  'number',
  'boolean',
  'json',
]);

/** A generic setting value, stored as JSON. */
export type SettingValue =
  string | number | boolean | Record<string, unknown> | unknown[];

/**
 * SMTP sender profiles. The password is stored only as an encryption envelope
 * (`secretEnc`); nullable because some relays authenticate by IP. At most one
 * row may be active at a time (partial unique index).
 */
export const smtpConfigs = pgTable(
  'smtp_configs',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port').notNull(),
    username: varchar('username', { length: 255 }),
    secretEnc: text('secret_enc'),
    secure: boolean('secure').notNull().default(true),
    fromAddress: varchar('from_address', { length: 255 }).notNull(),
    fromName: varchar('from_name', { length: 255 }),
    isActive: boolean('is_active').notNull().default(false),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: varchar('last_test_status', { length: 50 }),
  },
  (t) => [
    uniqueIndex('smtp_configs_single_active_idx')
      .on(t.isActive)
      .where(sql`${t.isActive} = true AND ${t.isDeleted} = false`),
  ],
);

/**
 * IMAP receiver profiles. Same secret + single-active discipline as SMTP,
 * minus the sender fields.
 */
export const imapConfigs = pgTable(
  'imap_configs',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port').notNull(),
    username: varchar('username', { length: 255 }),
    secretEnc: text('secret_enc'),
    secure: boolean('secure').notNull().default(true),
    isActive: boolean('is_active').notNull().default(false),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: varchar('last_test_status', { length: 50 }),
  },
  (t) => [
    uniqueIndex('imap_configs_single_active_idx')
      .on(t.isActive)
      .where(sql`${t.isActive} = true AND ${t.isDeleted} = false`),
  ],
);

/**
 * Outbound 3rd-party credentials. `secretEnc` (required) is the encrypted
 * token/secret; `meta` holds NON-secret fields (baseUrl, scopes, clientId…).
 * Unique per (provider, name) among live rows; multiple accounts per provider
 * are allowed.
 */
export const integrationCredentials = pgTable(
  'integration_credentials',
  {
    ...baseColumns,
    provider: varchar('provider', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    kind: credentialKind('kind').notNull().default('api_key'),
    secretEnc: text('secret_enc').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: varchar('last_test_status', { length: 50 }),
  },
  (t) => [
    uniqueIndex('integration_credentials_provider_name_idx')
      .on(t.provider, t.name)
      .where(sql`${t.isDeleted} = false`),
    index('integration_credentials_provider_idx').on(t.provider),
  ],
);

/**
 * Generic key/value app settings — non-secret by design (secrets belong in the
 * dedicated tables above). `valueJson` holds the typed value; `type` records
 * how to interpret it.
 */
export const systemSettings = pgTable(
  'system_settings',
  {
    ...baseColumns,
    key: varchar('key', { length: 150 }).notNull(),
    valueJson: jsonb('value_json').$type<SettingValue>().notNull(),
    type: settingType('type').notNull(),
    category: varchar('category', { length: 100 }).notNull().default('general'),
    description: varchar('description', { length: 500 }),
    /** False for values written by bootstrap/migration that admins must not edit. */
    isEditable: boolean('is_editable').notNull().default(true),
    /** Shipped default, enabling "reset" and showing drift from it. */
    defaultJson: jsonb('default_json').$type<SettingValue>(),
    /**
     * JSON-Schema fragment validated on write. Without it a bad value is only
     * discovered by the consumer at runtime, far from the admin who typed it.
     */
    validationJson: jsonb('validation_json').$type<Record<string, unknown>>(),
    updatedBy: uuid('updated_by').references(() => users.id),
    /** Optimistic concurrency: two admins editing one setting no longer race. */
    version: integer('version').notNull().default(0),
  },
  (t) => [
    uniqueIndex('system_settings_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('system_settings_category_idx').on(t.category),
  ],
);

/**
 * Append-only audit trail of admin changes to system records. Not soft-deleted
 * (no baseColumns). `metadata` is redacted — changed field NAMES only, never
 * secret values.
 */
export const systemAuditLog = pgTable(
  'system_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
  },
  (t) => [
    index('system_audit_entity_idx').on(t.entityType, t.entityId),
    index('system_audit_actor_idx').on(t.actorId),
    index('system_audit_created_idx').on(t.createdAt),
  ],
);

export type SmtpConfigRow = typeof smtpConfigs.$inferSelect;
export type NewSmtpConfigRow = typeof smtpConfigs.$inferInsert;
export type ImapConfigRow = typeof imapConfigs.$inferSelect;
export type NewImapConfigRow = typeof imapConfigs.$inferInsert;
export type IntegrationCredentialRow =
  typeof integrationCredentials.$inferSelect;
export type NewIntegrationCredentialRow =
  typeof integrationCredentials.$inferInsert;
export type SystemSettingRow = typeof systemSettings.$inferSelect;
export type NewSystemSettingRow = typeof systemSettings.$inferInsert;
export type SystemAuditRow = typeof systemAuditLog.$inferSelect;
export type NewSystemAuditRow = typeof systemAuditLog.$inferInsert;

/** Severity of a structured domain event. */
export const eventSeverity = pgEnum('event_severity', [
  'debug',
  'info',
  'warn',
  'error',
  'critical',
]);

/** Tables governed by a retention policy. */
export const retentionEntityType = pgEnum('retention_entity_type', [
  'activity_log',
  'system_event_log',
  'notifications',
  'notification_delivery_attempts',
  'sessions',
  'password_reset_codes',
  'email_messages',
  'search_records',
  'scheduled_job',
]);

/** What the retention sweep does when a row ages out. */
export const retentionAction = pgEnum('retention_action', [
  'purge',
  'anonymize',
  'archive',
]);

/**
 * Value history for `system_settings`. Append-only (no `baseColumns`).
 *
 * `system_audit_log.metadata` deliberately records changed field NAMES only,
 * because it also covers secret-bearing tables. Storing full values is safe here
 * precisely because this table covers `system_settings` alone, which is
 * non-secret by design — secrets live in the `*_configs` tables as encrypted
 * envelopes.
 */
export const systemSettingRevisions = pgTable(
  'system_setting_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settingId: uuid('setting_id')
      .notNull()
      .references(() => systemSettings.id),
    /** Denormalized so the history survives deletion of the setting itself. */
    key: varchar('key', { length: 150 }).notNull(),
    oldValueJson: jsonb('old_value_json').$type<SettingValue>(),
    newValueJson: jsonb('new_value_json').$type<SettingValue>(),
    changedBy: uuid('changed_by').references(() => users.id),
    reason: varchar('reason', { length: 500 }),
  },
  (t) => [
    index('system_setting_revisions_setting_idx').on(t.settingId, t.createdAt),
  ],
);

/**
 * Structured domain events an operator must be able to query transactionally
 * and join to business rows: sweep outcomes, integration failures, quota
 * breaches, retention purges. Append-only.
 *
 * Application logs deliberately do NOT go here. Request logs, stack traces and
 * debug output belong in stdout and the log shipper, where they are cheap and
 * rotated; in Postgres they would cost write throughput, disk and vacuum
 * pressure for nothing. The emission rule is `severity >= warn`, or an event
 * with a named operator consumer.
 */
export const systemEventLog = pgTable(
  'system_event_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    severity: eventSeverity('severity').notNull().default('info'),
    /** Emitting component, e.g. `search-indexing.processor`. */
    source: varchar('source', { length: 100 }).notNull(),
    /** Stable machine key, e.g. `search.reconcile.completed`. */
    eventKey: varchar('event_key', { length: 120 }).notNull(),
    message: varchar('message', { length: 1000 }).notNull(),
    /** Redacted through the same helper `system_audit_log` uses. */
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    /** Ties an event to request logs and BullMQ job ids. */
    correlationId: varchar('correlation_id', { length: 64 }),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('system_event_log_severity_idx').on(t.severity, t.createdAt),
    index('system_event_log_key_idx').on(t.eventKey, t.createdAt),
    index('system_event_log_correlation_idx').on(t.correlationId),
    index('system_event_log_created_idx').on(t.createdAt), // retention sweep
  ],
);

/**
 * Declarative retention. Retention used to be implicit and per-feature (the
 * search purge sweep, `auth-cleanup.scheduler`); this makes it one auditable
 * table that a single scheduler reads, so adding a rule is a row rather than a
 * new scheduler.
 */
export const dataRetentionPolicies = pgTable(
  'data_retention_policies',
  {
    ...baseColumns,
    entityType: retentionEntityType('entity_type').notNull(),
    retentionDays: integer('retention_days').notNull(),
    action: retentionAction('action').notNull().default('purge'),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: varchar('last_run_status', { length: 50 }),
    lastDeletedCount: integer('last_deleted_count'),
    description: varchar('description', { length: 500 }),
  },
  (t) => [
    uniqueIndex('data_retention_entity_idx')
      .on(t.entityType)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * Staged rollout switches. Each new capability module ships behind one, so a
 * bad release is a toggle away from being contained rather than a rollback.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    ...baseColumns,
    key: varchar('key', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    enabled: boolean('enabled').notNull().default(false),
    /** `{ userIds?, roles?, percentage? }` — evaluated by the flag service. */
    rollout: jsonb('rollout')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** A flag with no expiry silently becomes permanent configuration. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('feature_flags_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
  ],
);

export type SystemSettingRevisionRow =
  typeof systemSettingRevisions.$inferSelect;
export type NewSystemSettingRevisionRow =
  typeof systemSettingRevisions.$inferInsert;
export type SystemEventLogRow = typeof systemEventLog.$inferSelect;
export type NewSystemEventLogRow = typeof systemEventLog.$inferInsert;
export type DataRetentionPolicyRow = typeof dataRetentionPolicies.$inferSelect;
export type NewDataRetentionPolicyRow =
  typeof dataRetentionPolicies.$inferInsert;
export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type NewFeatureFlagRow = typeof featureFlags.$inferInsert;
