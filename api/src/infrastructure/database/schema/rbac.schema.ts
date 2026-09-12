import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { users } from './identity.schema';

/**
 * Fine-grained authorization, layered ON TOP of the existing coarse role gate —
 * it does not replace it.
 *
 * `users.role` stays the authoritative JWT claim that `RolesGuard` matches
 * against `@Roles(...)`. These tables answer the finer question ("does this
 * caller hold `project.task.update`?") that a single global role cannot.
 *
 * Four invariants keep this additive:
 *  1. `users.role` remains authoritative for the route gate; `roles` is seeded
 *     with rows whose `key` mirrors the `user_role` enum so the two vocabularies
 *     cannot diverge.
 *  2. Permissions are NEVER signed into a token. A token lives for its full TTL,
 *     so a permission revoked mid-session must take effect immediately;
 *     resolution happens per request against a Redis-cached set invalidated on
 *     every grant change (the pattern `SessionCacheService` already uses).
 *  3. `admin` short-circuits before any lookup. This layer only ever GRANTS.
 *  4. A route that requires no permission behaves exactly as it does today.
 */

/** A per-user exception's direction. Deny always wins over any grant. */
export const permissionEffect = pgEnum('permission_effect', ['allow', 'deny']);

/**
 * The capability catalog. Seeded from code (`is_system = true`), not
 * user-editable: a permission with no code behind it grants nothing, and a
 * `@RequirePermission` naming a row that does not exist would silently deny.
 * A boot-time assertion checks both directions, mirroring
 * `assertEveryRouteDeclaresPolicy`.
 */
export const permissions = pgTable(
  'permissions',
  {
    ...baseColumns,
    /** `<resource>.<action>`, e.g. `project.task.update`. */
    key: varchar('key', { length: 120 }).notNull(),
    resource: varchar('resource', { length: 60 }).notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    description: varchar('description', { length: 500 }),
    isSystem: boolean('is_system').notNull().default(true),
  },
  (t) => [
    uniqueIndex('permissions_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('permissions_resource_idx').on(t.resource),
  ],
);

/**
 * Named permission bundles. `priority` orders display and breaks ties only — it
 * is NOT a privilege ladder, because effective permissions are a set union and
 * a hierarchy would make "why can this person do that?" order-dependent.
 */
export const roles = pgTable(
  'roles',
  {
    ...baseColumns,
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    isSystem: boolean('is_system').notNull().default(false),
    priority: integer('priority').notNull().default(0),
  },
  (t) => [
    uniqueIndex('roles_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/** Which permissions a role carries. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    ...baseColumns,
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('role_permissions_pair_idx')
      .on(t.roleId, t.permissionId)
      .where(sql`${t.isDeleted} = false`),
    index('role_permissions_role_idx').on(t.roleId),
  ],
);

/**
 * Role grants. `expiresAt` supports time-boxed elevation; the resolver filters
 * on it at read time as well as the cleanup scheduler expiring it, so a stalled
 * scheduler cannot leave privilege standing.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_roles_pair_idx')
      .on(t.userId, t.roleId)
      .where(sql`${t.isDeleted} = false`),
    index('user_roles_user_idx').on(t.userId),
    index('user_roles_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

/**
 * Per-user exceptions to the role grants. `reason` is required: an exception
 * without a recorded reason becomes permanent by amnesia, which is how RBAC
 * systems stop being auditable.
 */
export const userPermissions = pgTable(
  'user_permissions',
  {
    ...baseColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    effect: permissionEffect('effect').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_permissions_pair_idx')
      .on(t.userId, t.permissionId)
      .where(sql`${t.isDeleted} = false`),
    index('user_permissions_user_idx').on(t.userId),
  ],
);

export type PermissionRow = typeof permissions.$inferSelect;
export type NewPermissionRow = typeof permissions.$inferInsert;
export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type NewRolePermissionRow = typeof rolePermissions.$inferInsert;
export type UserRoleRow = typeof userRoles.$inferSelect;
export type NewUserRoleRow = typeof userRoles.$inferInsert;
export type UserPermissionRow = typeof userPermissions.$inferSelect;
export type NewUserPermissionRow = typeof userPermissions.$inferInsert;
