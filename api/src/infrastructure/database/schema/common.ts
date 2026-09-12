import { boolean, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Reusable column set replacing the old TypeORM `BaseEntity`: a UUID primary
 * key, audit timestamps, and a soft-delete marker. Spread into a table:
 *
 *   export const users = pgTable('users', {
 *     ...baseColumns,
 *     email: varchar('email', { length: 255 }).notNull().unique(),
 *   });
 *
 * Soft-delete convention: `isDeleted` flips to `true` and `deletedAt` is stamped
 * when a row is deleted. `deletedAt` is nullable (null = live) — never
 * auto-populated — so it is a real deletion marker, not a second `updatedAt`.
 */
export const baseColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
