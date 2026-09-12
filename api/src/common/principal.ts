import { AppException } from '../infrastructure/exceptions/app-exception';
import { ErrorCode } from '../infrastructure/exceptions/error-codes';

/** Shared role vocabulary (mirrors the `user_role` DB enum). */
export type UserRole = 'guest' | 'user' | 'admin' | 'agent';

/** Discriminator for {@link Principal}. */
export type PrincipalKind = 'user' | 'service' | 'system' | 'anonymous';

/** A human account. `userId` IS a `users.id` and is safe to use as a FK. */
export interface UserPrincipal {
  kind: 'user';
  userId: string;
  role: 'user' | 'admin';
}

/**
 * A machine caller authenticated by a service credential.
 *
 * `credentialId` is a `service_credentials.id` — it is NOT a `users.id`, and
 * writing it into a column that references `users` violates the foreign key.
 * That is why it is deliberately not called `userId`.
 */
export interface ServicePrincipal {
  kind: 'service';
  credentialId: string;
  role: 'agent';
}

/**
 * Internal pipelines: queue processors, schedulers, bootstrap hooks. Privileged
 * for internal reads. NEVER constructed from an HTTP request — nothing maps a
 * token to this kind, so it cannot be forged by a caller.
 */
export interface SystemPrincipal {
  kind: 'system';
}

/** No token presented. Only reachable on `@Public()` routes. */
export interface AnonymousPrincipal {
  kind: 'anonymous';
}

/**
 * The acting principal.
 *
 * A discriminated union rather than `{ id: string | null }` on purpose. Under
 * the old shape `null` meant BOTH "anonymous guest" AND "trusted system
 * pipeline" — `SYSTEM_PRINCIPAL` and `GUEST_PRINCIPAL` were structurally
 * identical apart from `role`. Every ownership check of the form
 * `row.ownerId === principal.id` therefore granted an ownerless row to whichever
 * of the two happened to arrive, and service-credential ids flowed into columns
 * that reference `users.id`.
 *
 * With the union those states are unrepresentable: `principal.userId` does not
 * exist on `system`, so the compiler catches the conflation instead of a
 * reviewer. Use {@link userIdOrNull} for FK columns and {@link requireUserId}
 * where a real user is mandatory.
 */
export type Principal =
  UserPrincipal | ServicePrincipal | SystemPrincipal | AnonymousPrincipal;

/** System principal for internal (pipeline / scheduler) callers. */
export const SYSTEM_PRINCIPAL: SystemPrincipal = { kind: 'system' };

/** Anonymous caller — no token present. */
export const GUEST_PRINCIPAL: AnonymousPrincipal = { kind: 'anonymous' };

/** Narrows to a human account. */
export function isUser(principal: Principal): principal is UserPrincipal {
  return principal.kind === 'user';
}

/**
 * Whether the caller is an API administrator.
 *
 * Deliberately false for `system`: the system principal is privileged for
 * internal reads but is not an admin, and must never satisfy `@Roles('admin')`.
 */
export function isAdmin(principal: Principal): boolean {
  return principal.kind === 'user' && principal.role === 'admin';
}

/** The role `RolesGuard` matches against `@Roles(...)`. */
export function roleOf(principal: Principal): UserRole {
  switch (principal.kind) {
    case 'user':
      return principal.role;
    case 'service':
      return 'agent';
    case 'system':
      return 'agent';
    case 'anonymous':
      return 'guest';
  }
}

/**
 * The `users.id` for this principal, or null when there is none.
 *
 * The ONLY sanctioned way to populate a column that references `users.id`
 * (`agent_conversation.owner_user_id`, `agent_run.triggered_by_user_id`,
 * `system_audit_log.actor_id`, …).
 */
export function userIdOrNull(principal: Principal): string | null {
  return principal.kind === 'user' ? principal.userId : null;
}

/**
 * The `users.id` for this principal, or a 401 when the caller is not a user.
 * For routes and services that are meaningless without a human owner.
 */
export function requireUserId(principal: Principal): string {
  if (principal.kind !== 'user') {
    throw new AppException(ErrorCode.UNAUTHORIZED, {
      message: 'This operation requires an authenticated user account',
    });
  }
  return principal.userId;
}
