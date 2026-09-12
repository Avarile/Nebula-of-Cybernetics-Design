import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { PasswordService } from '../auth/password.service';
import { SessionRevocationService } from '../auth/session-revocation.service';
import { PermissionCacheService } from '../authorization/permission-cache.service';
import { PermissionRepository } from '../authorization/permission.repository';
import type { UserRow } from '../../infrastructure/database/schema/identity.schema';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import { UserRepository } from './user.repository';

/** User as exposed by the API — never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  role: UserRow['role'];
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repo: UserRepository,
    private readonly passwords: PasswordService,
    private readonly revocation: SessionRevocationService,
    private readonly permissionCache: PermissionCacheService,
    private readonly permissions: PermissionRepository,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: UserRow): PublicUser {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      displayName: row.displayName ?? null,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt ?? null,
    };
  }

  /**
   * Provision an account, and give it the capabilities its role implies.
   *
   * The role assignment is not decoration. `users.role` is the coarse JWT claim;
   * the permission resolver reads a user's grants exclusively from `user_roles`,
   * so an account created without a row there resolves to the empty set. Every
   * account provisioned before this landed was inert — `contact.create`,
   * `knowledge.create`, `project.task.create` and the rest of the documented
   * "baseline capabilities every human account receives" were received by
   * nobody until an admin granted the role by hand.
   */
  async create(dto: CreateUserDto): Promise<PublicUser> {
    const email = dto.email.toLowerCase();
    if (await this.repo.findByEmail(email)) {
      throw this.errors.create(ErrorCode.USER_EMAIL_TAKEN);
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const row = await this.repo.create({
      email,
      passwordHash,
      role: dto.role ?? 'user',
      displayName: dto.displayName,
    });
    await this.syncRoleAssignment(row.id, null, row.role);
    return this.toPublic(row);
  }

  /**
   * Keep `user_roles` in step with the coarse `users.role`.
   *
   * Additive on create, a swap on change. Only the role that mirrors
   * `users.role` is touched: roles an administrator granted deliberately —
   * `project_manager`, `finance_manager` — are somebody else's decision and
   * are left exactly as they are.
   *
   * A missing role row is logged rather than thrown: the account itself is
   * already committed, and failing the request would leave the caller thinking
   * nothing happened.
   */
  private async syncRoleAssignment(
    userId: string,
    previous: UserRow['role'] | null,
    next: UserRow['role'],
  ): Promise<void> {
    if (previous === next) return;

    if (previous) {
      const stale = await this.permissions.findRoleByKey(previous);
      if (stale) await this.permissions.revokeRole(userId, stale.id);
    }

    const role = await this.permissions.findRoleByKey(next);
    if (!role) {
      this.logger.error(
        `No "${next}" role is seeded — user ${userId} has no permissions. Run the RBAC seeder.`,
      );
      return;
    }
    await this.permissions.grantRole(userId, role.id, null, null);
    await this.permissionCache.invalidateAll();
  }

  async findById(id: string): Promise<PublicUser> {
    const row = await this.repo.findActiveById(id);
    if (!row) throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    return this.toPublic(row);
  }

  async list(page: number, limit: number) {
    const { rows, total } = await this.repo.list(page, limit);
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  /**
   * Admin edit of a user.
   *
   * A role or password change revokes every session the user holds. Both are
   * security-relevant state baked into already-issued tokens: the role is a
   * signed claim, so a demotion is invisible until a new token is minted, and a
   * password reset that leaves old sessions alive defeats the point of resetting
   * it. Until now this path revoked nothing at all, so
   * `PATCH /users/:id {password}` and `PATCH /auth/password` — the same change
   * by two routes — had different security outcomes.
   *
   * A `displayName` edit is not security-relevant and does not log anyone out.
   */
  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    const before = await this.findById(id); // 404 if missing
    const patch: Record<string, unknown> = {};
    if (dto.role) patch.role = dto.role;
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.password)
      patch.passwordHash = await this.passwords.hash(dto.password);
    const row = await this.repo.update(id, patch);
    if (!row) throw this.errors.create(ErrorCode.USER_NOT_FOUND);
    if (dto.role || dto.password) {
      await this.revocation.revokeAllForUser(id);
    }
    if (dto.role) {
      // The role is a signed claim AND the seed of this user's permission set.
      // Revoking sessions handles the former; moving the `user_roles` row
      // handles the latter, and invalidates the cache on its way through.
      // Flushing the cache alone was not enough: it re-resolved to the same
      // stale grants, so a demoted admin kept nothing and a promoted user
      // gained nothing.
      await this.syncRoleAssignment(id, before.role, row.role);
    }
    return this.toPublic(row);
  }

  /**
   * Soft-delete a user, and cut off their access with it. Previously the row was
   * flagged deleted while every session — and every access token minted from
   * one — kept working.
   */
  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.softDelete(id);
    await this.revocation.revokeAllForUser(id);
    await this.permissionCache.invalidateAll();
  }
}
