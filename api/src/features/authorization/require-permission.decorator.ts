import { SetMetadata } from '@nestjs/common';

/** Metadata key holding the permissions a route requires. */
export const PERMISSIONS_KEY = 'required-permissions';

/**
 * Require one or more permissions on a route (or controller).
 *
 * Multiple keys are AND-ed: the caller must hold all of them. That is the
 * conservative reading, and an OR is expressible by declaring a coarser
 * permission rather than by making the decorator ambiguous.
 *
 * A route with no `@RequirePermission` behaves exactly as before this layer
 * existed — adoption is per-route, and `@Roles` still gates it.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
