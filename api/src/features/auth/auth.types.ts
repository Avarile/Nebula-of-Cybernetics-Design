import type { PrincipalKind, UserRole } from '../../common/principal';

/** Signed into every access token; read back by JwtStrategy.validate. */
export interface AccessTokenClaims {
  sub: string; // user id or service-credential id
  role: UserRole;
  email?: string;
  kind: 'user' | 'service';
  /**
   * The `sessions.id` this token was minted from. Present on every `user`
   * token; absent on `service` tokens, which have no session (a service
   * credential is revoked through its own row instead).
   *
   * This is what makes an access token revocable. Without it the token asserts
   * an identity that nothing can withdraw for the whole of its TTL, so
   * `logout-all`, a password change, a role change and a soft-delete all left
   * the bearer fully authenticated. The `sessions` table already recorded every
   * one of those revocations — the token simply was not linked to it.
   */
  sid?: string;
}

/**
 * Shape returned by GET /auth/me — the acting principal enriched with the
 * user's profile fields (email + display name) from the DB. `email`/`displayName`
 * are absent for non-user callers (e.g. service credentials), which have no
 * users row.
 *
 * `id` is the subject as the caller knows it: a `users.id` for a human, a
 * `service_credentials.id` for a machine, null for system/anonymous. `kind`
 * says which — read it rather than inferring identity type from `id` alone.
 */
export interface UserProfile {
  id: string | null;
  kind: PrincipalKind;
  role?: UserRole;
  email?: string;
  displayName?: string | null;
}

/** What the login/refresh endpoints return. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token lifetime, seconds
}

/** An opaque refresh token (returned to client) plus the hash we persist. */
export interface GeneratedRefreshToken {
  token: string;
  tokenHash: string;
}
