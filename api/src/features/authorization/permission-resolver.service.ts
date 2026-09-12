import { Injectable } from '@nestjs/common';
import { isAdmin, roleOf, type Principal } from '../../common/principal';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionRepository } from './permission.repository';

/**
 * Decides whether a principal holds a permission.
 *
 * The algorithm, in full:
 *
 *   admin                       -> everything, without a lookup
 *   anonymous                   -> nothing
 *   user     -> union of role grants, plus allow-overrides, minus deny-overrides
 *   service  -> grants of the role matching its role key (`agent`)
 *   system   -> everything (internal pipelines; not an admin, but privileged)
 *
 * Set union then set difference, so the answer does not depend on evaluation
 * order — an ordered rule list is where RBAC systems stop being explainable.
 * Deny always wins.
 *
 * Nothing here is signed into a token. An access token lives for its whole TTL,
 * so a permission revoked mid-session has to take effect on the next request,
 * which means resolving per request against shared, invalidatable state.
 */
@Injectable()
export class PermissionResolver {
  constructor(
    private readonly repo: PermissionRepository,
    private readonly cache: PermissionCacheService,
  ) {}

  /** Whether the principal holds `permissionKey`. */
  async can(principal: Principal, permissionKey: string): Promise<boolean> {
    // Short-circuit BEFORE any lookup: this layer only ever grants, so no
    // absence of a row can take a capability away from an admin.
    if (isAdmin(principal)) return true;
    if (principal.kind === 'system') return true;
    if (principal.kind === 'anonymous') return false;

    const keys = await this.effectivePermissions(principal);
    return keys.has(permissionKey);
  }

  /** Every permission key the principal effectively holds. */
  async effectivePermissions(principal: Principal): Promise<Set<string>> {
    if (isAdmin(principal) || principal.kind === 'system') {
      return new Set(await this.repo.allPermissionKeys());
    }
    if (principal.kind === 'anonymous') return new Set();

    const subject =
      principal.kind === 'user'
        ? `user:${principal.userId}`
        : `role:${roleOf(principal)}`;

    const cached = await this.cache.get(subject);
    if (cached) return new Set(cached);

    const keys =
      principal.kind === 'user'
        ? await this.resolveUser(principal.userId)
        : // A service credential has no `users` row and therefore no
          // `user_roles`; its capabilities are whatever its role carries.
          await this.repo.permissionKeysForRoleKey(roleOf(principal));

    await this.cache.set(subject, keys);
    return new Set(keys);
  }

  private async resolveUser(userId: string): Promise<string[]> {
    const [granted, overrides] = await Promise.all([
      this.repo.permissionKeysForUser(userId),
      this.repo.overridesForUser(userId),
    ]);
    const effective = new Set(granted);
    for (const o of overrides) {
      if (o.effect === 'allow') effective.add(o.key);
    }
    // Applied last and unconditionally: deny wins over every grant, whatever
    // order the rows arrived in.
    for (const o of overrides) {
      if (o.effect === 'deny') effective.delete(o.key);
    }
    return [...effective];
  }
}
