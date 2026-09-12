import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { contacts } from './contact.schema';
import { files } from './file.schema';
import { users } from './identity.schema';
import { settingType } from './system.schema';

/**
 * Profile fields, kept OUT of `users` on purpose.
 *
 * `users` is on the hot authentication path — every login and every
 * `JwtStrategy.validate` reads it — and carries exactly what authentication
 * needs. Profile data is wide, mostly nullable, rarely read on that path, and
 * PII-dense: widening `users` would put avatars and phone numbers into every
 * token validation and scatter the fields an export or erasure request must
 * cover. The row is created lazily on first profile write, not at signup.
 *
 * PII register — an erasure request anonymizes `user_profiles`, `contacts`,
 * `contact_channels`, `email_messages` and `activity_log.ip`, and nothing else.
 */
export const userProfiles = pgTable(
  'user_profiles',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: varchar('first_name', { length: 120 }),
    lastName: varchar('last_name', { length: 120 }),
    /** `users.displayName` remains the denormalized form the auth layer reads. */
    avatarFileId: uuid('avatar_file_id').references(() => files.id),
    jobTitle: varchar('job_title', { length: 150 }),
    department: varchar('department', { length: 150 }),
    phone: varchar('phone', { length: 40 }),
    /** IANA zone. Read by the notification scheduler for quiet hours and digests. */
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    /** Selects the `notification_templates` row; falls back to `en`. */
    locale: varchar('locale', { length: 16 }).notNull().default('en'),
    dateFormat: varchar('date_format', { length: 32 }),
    timeFormat: varchar('time_format', { length: 32 }),
    bio: varchar('bio', { length: 2000 }),
    /** Optional back-link when a staff member is also a CRM contact. */
    contactId: uuid('contact_id').references(() => contacts.id),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('user_profiles_user_idx')
      .on(t.userId)
      .where(sql`${t.isDeleted} = false`),
    index('user_profiles_contact_idx').on(t.contactId),
  ],
);

/**
 * Per-user settings, mirroring the `system_settings` shape (and reusing its
 * `setting_type` enum) so one typed read/validate helper serves both.
 * Resolution order: this table, then `system_settings.defaultJson`, then the
 * compiled-in default.
 *
 * Notification preferences are deliberately NOT stored here: they are queried
 * in bulk by the send path ("who wants `task.assigned` by email?"), which a
 * key/value bag cannot answer without a JSONB scan per recipient.
 */
export const userPreferences = pgTable(
  'user_preferences',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 150 }).notNull(),
    valueJson: jsonb('value_json')
      .$type<string | number | boolean | Record<string, unknown> | unknown[]>()
      .notNull(),
    type: settingType('type').notNull(),
  },
  (t) => [
    uniqueIndex('user_preferences_user_key_idx')
      .on(t.userId, t.key)
      .where(sql`${t.isDeleted} = false`),
  ],
);

export type UserProfileRow = typeof userProfiles.$inferSelect;
export type NewUserProfileRow = typeof userProfiles.$inferInsert;
export type UserPreferenceRow = typeof userPreferences.$inferSelect;
export type NewUserPreferenceRow = typeof userPreferences.$inferInsert;
