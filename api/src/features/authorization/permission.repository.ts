import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  permissions,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  type PermissionRow,
  type RoleRow,
} from '../../infrastructure/database/schema/rbac.schema';
import { users } from '../../infrastructure/database/schema/identity.schema';

/** A per-user exception, as the resolver consumes it. */
export interface UserOverride {
  key: string;
  effect: 'allow' | 'deny';
}

@Injectable()
export class PermissionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Unexpired-grant predicate, applied at READ time as well as by the cleanup
   * scheduler. A stalled scheduler must not be able to leave privilege standing.
   */
  private live(expiresAt: PgColumn): SQL {
    return or(isNull(expiresAt), gt(expiresAt, new Date()))!;
  }

  /** Permission keys a user holds through their roles. */
  async permissionKeysForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(userRoles)
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.roleId, userRoles.roleId),
          eq(rolePermissions.isDeleted, false),
        ),
      )
      .innerJoin(
        permissions,
        and(
          eq(permissions.id, rolePermissions.permissionId),
          eq(permissions.isDeleted, false),
        ),
      )
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.isDeleted, false),
          this.live(userRoles.expiresAt),
        ),
      );
    return rows.map((r) => r.key);
  }

  /** Permission keys carried by one role, addressed by its stable key. */
  async permissionKeysForRoleKey(roleKey: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(roles)
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.roleId, roles.id),
          eq(rolePermissions.isDeleted, false),
        ),
      )
      .innerJoin(
        permissions,
        and(
          eq(permissions.id, rolePermissions.permissionId),
          eq(permissions.isDeleted, false),
        ),
      )
      .where(and(eq(roles.key, roleKey), eq(roles.isDeleted, false)));
    return rows.map((r) => r.key);
  }

  /** Per-user allow/deny exceptions, unexpired. */
  async overridesForUser(userId: string): Promise<UserOverride[]> {
    const rows = await this.db
      .select({ key: permissions.key, effect: userPermissions.effect })
      .from(userPermissions)
      .innerJoin(
        permissions,
        and(
          eq(permissions.id, userPermissions.permissionId),
          eq(permissions.isDeleted, false),
        ),
      )
      .where(
        and(
          eq(userPermissions.userId, userId),
          eq(userPermissions.isDeleted, false),
          this.live(userPermissions.expiresAt),
        ),
      );
    return rows;
  }

  /** Every permission key in the catalog — used by the boot assertion. */
  async allPermissionKeys(): Promise<string[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(permissions)
      .where(eq(permissions.isDeleted, false));
    return rows.map((r) => r.key);
  }

  async listPermissions(): Promise<PermissionRow[]> {
    return this.db
      .select()
      .from(permissions)
      .where(eq(permissions.isDeleted, false))
      .orderBy(asc(permissions.key));
  }

  async listRoles(): Promise<RoleRow[]> {
    return this.db
      .select()
      .from(roles)
      .where(eq(roles.isDeleted, false))
      .orderBy(asc(roles.priority), asc(roles.key));
  }

  async findRoleByKey(key: string): Promise<RoleRow | null> {
    const rows = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.key, key), eq(roles.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findRoleById(id: string): Promise<RoleRow | null> {
    const rows = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPermissionByKey(key: string): Promise<PermissionRow | null> {
    const rows = await this.db
      .select()
      .from(permissions)
      .where(and(eq(permissions.key, key), eq(permissions.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Roles held by a user, with their grant metadata. */
  async rolesForUser(userId: string) {
    return this.db
      .select({
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        grantedBy: userRoles.grantedBy,
        expiresAt: userRoles.expiresAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.isDeleted, false)));
  }

  async grantRole(
    userId: string,
    roleId: string,
    grantedBy: string | null,
    expiresAt: Date | null,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.isDeleted, false),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(userRoles)
        .set({ expiresAt, grantedBy })
        .where(eq(userRoles.id, existing[0].id));
      return;
    }
    await this.db
      .insert(userRoles)
      .values({ userId, roleId, grantedBy, expiresAt });
  }

  async revokeRole(userId: string, roleId: string): Promise<boolean> {
    const rows = await this.db
      .update(userRoles)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.isDeleted, false),
        ),
      )
      .returning({ id: userRoles.id });
    return rows.length > 0;
  }

  /**
   * Whether a live user account exists.
   *
   * Queried here rather than through `UsersModule` on purpose: importing it
   * would make Users -> Authorization -> Users circular, since Users needs this
   * module to invalidate the permission cache on a role change. This is a
   * foreign-key existence check, not business logic.
   */
  async userExists(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * The live user's base role, or null if there is no such user.
   *
   * `userExists` cannot answer the question `effectiveFor` actually has to ask:
   * an admin's capabilities come from `users.role`, not from any `user_roles`
   * row, so a report built only from grant tables describes an admin as holding
   * nothing. Same no-import-UsersModule reasoning as above.
   */
  async findLiveUserRole(
    userId: string,
  ): Promise<(typeof users.$inferSelect)['role'] | null> {
    const rows = await this.db
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    return rows[0]?.role ?? null;
  }

  async countRoleMembers(roleId: string): Promise<number> {
    const totals = await this.db
      .select({ value: count() })
      .from(userRoles)
      .where(and(eq(userRoles.roleId, roleId), eq(userRoles.isDeleted, false)));
    return Number(totals[0]?.value ?? 0);
  }

  /** Per-user exceptions with their audit trail — the admin-facing view. */
  async overridesDetailForUser(userId: string) {
    return this.db
      .select({
        id: userPermissions.id,
        permissionKey: permissions.key,
        effect: userPermissions.effect,
        reason: userPermissions.reason,
        grantedBy: userPermissions.grantedBy,
        expiresAt: userPermissions.expiresAt,
        createdAt: userPermissions.createdAt,
      })
      .from(userPermissions)
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .where(
        and(
          eq(userPermissions.userId, userId),
          eq(userPermissions.isDeleted, false),
        ),
      )
      .orderBy(asc(permissions.key));
  }

  /**
   * Upsert an override.
   *
   * Mirrors `grantRole`: re-granting an exception that already stands updates
   * it in place, because the partial unique index on
   * (user_id, permission_id) WHERE is_deleted = false would otherwise turn a
   * corrected reason into a constraint violation.
   */
  async grantPermission(
    userId: string,
    permissionId: string,
    effect: 'allow' | 'deny',
    reason: string,
    grantedBy: string | null,
    expiresAt: Date | null,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: userPermissions.id })
      .from(userPermissions)
      .where(
        and(
          eq(userPermissions.userId, userId),
          eq(userPermissions.permissionId, permissionId),
          eq(userPermissions.isDeleted, false),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(userPermissions)
        .set({ effect, reason, grantedBy, expiresAt })
        .where(eq(userPermissions.id, existing[0].id));
      return;
    }
    await this.db
      .insert(userPermissions)
      .values({ userId, permissionId, effect, reason, grantedBy, expiresAt });
  }

  async revokePermission(
    userId: string,
    permissionId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .update(userPermissions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(userPermissions.userId, userId),
          eq(userPermissions.permissionId, permissionId),
          eq(userPermissions.isDeleted, false),
        ),
      )
      .returning({ id: userPermissions.id });
    return rows.length > 0;
  }
}
