import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';

/**
 * Shared role vocabulary for JWT claims and RolesGuard checks.
 *  guest — anonymous request, never stored (no token present)
 *  user  — standard human account (email + password)
 *  admin — elevated human account (email + password)
 *  agent — machine caller, authenticated via a service credential
 */
export const userRole = pgEnum('user_role', [
  'guest',
  'user',
  'admin',
  'agent',
]);

/** Human accounts. Only `user`/`admin` in practice; enum keeps all four. */
export const users = pgTable(
  'users',
  {
    ...baseColumns,
    email: varchar('email', { length: 255 }).notNull(), // stored lowercased
    passwordHash: text('password_hash').notNull(), // argon2id
    role: userRole('role').notNull().default('user'),
    displayName: varchar('display_name', { length: 255 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_unique_idx')
      .on(t.email)
      .where(sql`${t.isDeleted} = false`),
    index('users_role_idx').on(t.role),
  ],
);

/**
 * Refresh-token sessions. The refresh token is an opaque random string; only
 * its sha256 hash is stored. `familyId` is the rotation lineage: rotating keeps
 * the family; replaying a revoked token revokes the whole family (theft
 * response). `revokedAt` is the deletion marker, so baseColumns is not used.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: varchar('user_agent', { length: 512 }),
    ip: varchar('ip', { length: 45 }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

/** Agent API keys. Plaintext key is shown once; only the sha256 hash is kept. */
export const serviceCredentials = pgTable(
  'service_credentials',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 32 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    role: userRole('role').notNull().default('agent'),
    createdBy: uuid('created_by').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('service_credentials_key_hash_idx').on(t.keyHash),
    index('service_credentials_prefix_idx').on(t.keyPrefix),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type ServiceCredentialRow = typeof serviceCredentials.$inferSelect;
export type NewServiceCredentialRow = typeof serviceCredentials.$inferInsert;
