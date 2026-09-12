import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../../common/principal';
import { userIdOrNull } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ActivityService } from '../shared/activity.service';
import type { GrantPermissionDto, GrantRoleDto } from './dto/rbac.dto';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionRepository } from './permission.repository';
import { PermissionResolver } from './permission-resolver.service';

/**
 * Administration of roles and grants.
 *
 * Every mutating path ends in `cache.invalidateAll()`. That is the whole
 * correctness story for this layer: permissions are resolved per request from a
 * shared cache, so a grant that is not invalidated is a grant that keeps
 * applying for the cache TTL after it was revoked.
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly repo: PermissionRepository,
    private readonly cache: PermissionCacheService,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
    private readonly resolver: PermissionResolver,
  ) {}

  async listPermissions() {
    const rows = await this.repo.listPermissions();
    return rows.map((p) => ({
      key: p.key,
      resource: p.resource,
      action: p.action,
      description: p.description ?? null,
    }));
  }

  async listRoles() {
    const rows = await this.repo.listRoles();
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description ?? null,
        isSystem: r.isSystem,
        priority: r.priority,
        permissions: await this.repo.permissionKeysForRoleKey(r.key),
        memberCount: await this.repo.countRoleMembers(r.id),
      })),
    );
  }

  async rolesForUser(userId: string) {
    if (!(await this.repo.userExists(userId))) {
      throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    }
    return this.repo.rolesForUser(userId);
  }

  async grantRole(
    userId: string,
    dto: GrantRoleDto,
    principal: Principal,
  ): Promise<void> {
    if (!(await this.repo.userExists(userId))) {
      throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    }
    const role = await this.repo.findRoleByKey(dto.roleKey);
    if (!role) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Unknown role "${dto.roleKey}"`,
      });
    }
    await this.repo.grantRole(
      userId,
      role.id,
      userIdOrNull(principal),
      dto.expiresAt ?? null,
    );
    await this.cache.invalidateAll();
    await this.activity.recordSafe({
      principal,
      entityType: 'user',
      entityId: userId,
      action: 'rbac.role_granted',
      summary: `Granted role "${role.key}"`,
      changes: { roles: { from: null, to: role.key } },
    });
    this.logger.warn(`Role "${role.key}" granted to user ${userId}`);
  }

  async revokeRole(
    userId: string,
    roleKey: string,
    principal: Principal,
  ): Promise<void> {
    const role = await this.repo.findRoleByKey(roleKey);
    if (!role) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Unknown role "${roleKey}"`,
      });
    }
    const revoked = await this.repo.revokeRole(userId, role.id);
    if (!revoked) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `User does not hold role "${roleKey}"`,
      });
    }
    await this.cache.invalidateAll();
    await this.activity.recordSafe({
      principal,
      entityType: 'user',
      entityId: userId,
      action: 'rbac.role_revoked',
      summary: `Revoked role "${role.key}"`,
      changes: { roles: { from: role.key, to: null } },
    });
    this.logger.warn(`Role "${role.key}" revoked from user ${userId}`);
  }

  /**
   * What a principal effectively holds — the "why can they do that?" answer.
   *
   * Delegates to `PermissionResolver`, the same code the guard runs, rather
   * than re-deriving the answer from the grant tables. It used to do the
   * latter, and the two disagreed precisely where it mattered most: the
   * resolver short-circuits an admin to every permission without a lookup,
   * while a grant-table walk found no `user_roles` rows and reported `[]`. An
   * operator auditing an admin was told they held nothing, on the endpoint
   * whose entire purpose is to explain why someone can do something.
   *
   * One implementation, so the report cannot drift from enforcement again.
   */
  async effectiveFor(userId: string): Promise<string[]> {
    const role = await this.repo.findLiveUserRole(userId);
    if (!role) throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    const principal: Principal = {
      kind: 'user',
      userId,
      role: role === 'admin' ? 'admin' : 'user',
    };
    return [...(await this.resolver.effectivePermissions(principal))].sort();
  }

  /**
   * The exceptions as granted, with their audit trail.
   *
   * Distinct from `effectiveFor`, which returns the resolved answer: this is
   * the "what was deliberately changed for this person, by whom, and why"
   * view that makes an override reviewable instead of merely observable.
   */
  async overridesForUser(userId: string) {
    if (!(await this.repo.userExists(userId))) {
      throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    }
    return this.repo.overridesDetailForUser(userId);
  }

  async grantPermission(
    userId: string,
    dto: GrantPermissionDto,
    principal: Principal,
  ): Promise<void> {
    if (!(await this.repo.userExists(userId))) {
      throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    }
    const permission = await this.repo.findPermissionByKey(dto.permissionKey);
    if (!permission) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Unknown permission "${dto.permissionKey}"`,
      });
    }
    await this.repo.grantPermission(
      userId,
      permission.id,
      dto.effect,
      dto.reason,
      userIdOrNull(principal),
      dto.expiresAt ?? null,
    );
    await this.cache.invalidateAll();
    await this.activity.recordSafe({
      principal,
      entityType: 'user',
      entityId: userId,
      action: 'rbac.permission_granted',
      summary: `${dto.effect === 'deny' ? 'Denied' : 'Allowed'} "${permission.key}" — ${dto.reason}`,
      changes: {
        permissions: { from: null, to: `${dto.effect}:${permission.key}` },
      },
    });
    this.logger.warn(
      `Permission override "${dto.effect}" on "${permission.key}" set for user ${userId}`,
    );
  }

  async revokePermission(
    userId: string,
    permissionKey: string,
    principal: Principal,
  ): Promise<void> {
    const permission = await this.repo.findPermissionByKey(permissionKey);
    if (!permission) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Unknown permission "${permissionKey}"`,
      });
    }
    const revoked = await this.repo.revokePermission(userId, permission.id);
    if (!revoked) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `User holds no override for "${permissionKey}"`,
      });
    }
    await this.cache.invalidateAll();
    await this.activity.recordSafe({
      principal,
      entityType: 'user',
      entityId: userId,
      action: 'rbac.permission_revoked',
      summary: `Revoked the override on "${permission.key}"`,
      changes: { permissions: { from: permission.key, to: null } },
    });
    this.logger.warn(
      `Permission override on "${permission.key}" revoked from user ${userId}`,
    );
  }
}
