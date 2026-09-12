import { Injectable } from '@nestjs/common';
import { ServiceCredentialRepository } from './service-credential.repository';
import { SessionRepository } from './session.repository';
import { TokenValidityService } from './token-validity.service';

/**
 * The one way to revoke access.
 *
 * Revoking is two operations that must not come apart: write `revokedAt` in
 * Postgres, and drop the cached "still live" verdict so the change is visible on
 * the very next request. Leaving that pairing to each caller is how the original
 * defect worked — six call sites already revoked sessions correctly, and every
 * one of them missed the access token, because the second half of the job was
 * nobody's explicit responsibility.
 *
 * Callers use this instead of `SessionRepository`'s revoke methods, so a new
 * revocation path cannot silently skip the cache.
 */
@Injectable()
export class SessionRevocationService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly credentials: ServiceCredentialRepository,
    private readonly validity: TokenValidityService,
  ) {}

  /** Revoke one session (logout). */
  async revokeSession(sessionId: string): Promise<void> {
    await this.validity.invalidate(
      'user',
      await this.sessions.revokeById(sessionId),
    );
  }

  /**
   * Atomically claim a session for refresh rotation.
   *
   * Returns false when another concurrent request already rotated it, so the
   * caller can refuse rather than mint a second live lineage from one token.
   */
  async claimForRotation(sessionId: string): Promise<boolean> {
    const claimed = await this.sessions.claimForRotation(sessionId);
    if (claimed) await this.validity.invalidate('user', [sessionId]);
    return claimed;
  }

  /** Revoke a whole rotation lineage (refresh-token reuse / suspected theft). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.validity.invalidate(
      'user',
      await this.sessions.revokeFamily(familyId),
    );
  }

  /**
   * Revoke every session a user holds — logout-all, password change, role
   * change, account deletion. Forces re-authentication everywhere, which is
   * also what makes a role change take effect immediately: the new role is only
   * read when a fresh token is minted.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.validity.invalidate(
      'user',
      await this.sessions.revokeAllForUser(userId),
    );
  }

  /** Revoke a service credential. It has no session; its own row is the record. */
  async revokeCredential(credentialId: string): Promise<void> {
    await this.credentials.revoke(credentialId);
    await this.validity.invalidate('service', [credentialId]);
  }
}
