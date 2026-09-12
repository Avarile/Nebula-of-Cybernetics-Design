import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { GUEST_PRINCIPAL, type Principal } from '../principal';

/**
 * Resolves the acting principal for a request. Reads `request.user`, which the
 * JwtAuthGuard populates from a verified access token. Falls back to the guest
 * principal on `@Public()` routes with no token. Controller/service signatures
 * are unchanged from the previous placeholder.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: Principal }>();
    return req.user ?? GUEST_PRINCIPAL;
  },
);
