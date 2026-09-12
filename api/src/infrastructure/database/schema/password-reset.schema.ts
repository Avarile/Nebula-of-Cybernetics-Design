import {
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './identity.schema';

/**
 * Single-use password-reset codes. The 6-digit code is stored ONLY as an
 * HMAC-SHA256 (keyed with a server pepper) hex digest — never in plaintext.
 * `consumedAt` is the burn/single-use marker (null = live). Append-style
 * lifecycle, so `baseColumns` is not used (same reasoning as `sessions`).
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('password_reset_codes_user_idx').on(t.userId),
    index('password_reset_codes_expires_idx').on(t.expiresAt),
  ],
);

export type PasswordResetCodeRow = typeof passwordResetCodes.$inferSelect;
export type NewPasswordResetCodeRow = typeof passwordResetCodes.$inferInsert;
