import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUEST_PRINCIPAL, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { PERMISSIONS_KEY } from './require-permission.decorator';
import { PermissionResolver } from './permission-resolver.service';

/**
 * Global authorization guard for fine-grained permissions. Runs after
 * `RolesGuard`, so the coarse role gate has already been applied.
 *
 * A route without `@RequirePermission` passes through untouched — this layer is
 * additive, and `assertEveryRouteDeclaresPolicy` continues to guarantee that
 * every route declares at least `@Roles` or `@Public()`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolver,
    private readonly errors: ExceptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: Principal }>();
    const principal = req.user ?? GUEST_PRINCIPAL;

    const held = await this.resolver.effectivePermissions(principal);
    const missing = required.filter((key) => !held.has(key));
    if (missing.length === 0) return true;

    // Name what was missing: an opaque 403 on a permission-gated route is the
    // single most expensive thing to debug in an RBAC system, and the caller
    // learning which capability they lack discloses nothing they could not
    // infer from the route itself.
    throw this.errors.create(ErrorCode.FORBIDDEN, {
      message: `Missing required permission(s): ${missing.join(', ')}`,
    });
  }
}
