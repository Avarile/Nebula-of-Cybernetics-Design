import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  GUEST_PRINCIPAL,
  roleOf,
  type Principal,
  type UserRole,
} from '../principal';

/**
 * Global authorization guard (runs after JwtAuthGuard). If a route/controller
 * declares `@Roles(...)`, the request principal's role must be in the set.
 *
 * A route without `@Roles` passes through here — but that is no longer an
 * implicit "open to everyone", because `assertEveryRouteDeclaresPolicy` refuses
 * to boot an application containing a handler that declares neither `@Roles`
 * nor `@Public()`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<{ user?: Principal }>();
    return required.includes(roleOf(req.user ?? GUEST_PRINCIPAL));
  }
}
