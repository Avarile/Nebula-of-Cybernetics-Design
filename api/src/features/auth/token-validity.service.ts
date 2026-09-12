import { Injectable, Logger } from '@nestjs/common';
import { SessionCacheService } from '../../infrastructure/cache/session/session-cache.service';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { AccessTokenClaims } from './auth.types';
import { ServiceCredentialRepository } from './service-credential.repository';
import { SessionRepository } from './session.repository';

/** What gets cached — just the verdict; the identity comes from the token. */
interface CachedVerdict {
  live: boolean;
}

/**
 * How long a verdict stays cached. Only a backstop: every revocation path
 * deletes the key outright, so this bounds the damage of a delete that did not
 * land (Redis blip mid-revoke), not the normal case.
 */
const VERDICT_TTL_SECONDS = 30;

/**
 * Answers one question: is the identity behind this access token still good?
 *
 * `JwtStrategy` verifies the signature and expiry, which together prove the
 * token was issued by us and has not aged out — and nothing more. Whether the
 * session still exists, the user still exists, or the credential is still valid
 * is a question about *current* state, and a signed claim cannot answer it.
 * Without this service a token stayed fully authoritative for its whole TTL, so
 * `logout-all`, a password change, a role change, a soft-delete and a credential
 * revocation were all advisory.
 *
 * Revocation is not modelled separately: for a user the `sessions` row the token
 * was minted from IS the revocation record (`sid` links them), and for a machine
 * caller it is the `service_credentials` row.
 */
@Injectable()
export class TokenValidityService {
  private readonly logger = new Logger(TokenValidityService.name);

  constructor(
    private readonly sessions: SessionRepository,
    private readonly credentials: ServiceCredentialRepository,
    private readonly cache: SessionCacheService,
    private readonly errors: ExceptionService,
  ) {}

  /** Throws unless the token's subject is still live. */
  async assertLive(claims: AccessTokenClaims): Promise<void> {
    const key = this.cacheKey(claims);
    if (!key) throw this.dead('Token carries no revocable identity');

    const cached = await this.readCache(key);
    if (cached) {
      if (!cached.live)
        throw this.dead('Session or credential is no longer valid');
      return;
    }

    const live = await this.readSource(claims);
    await this.writeCache(key, live);
    if (!live) throw this.dead('Session or credential is no longer valid');
  }

  /** Drop cached verdicts so a revocation takes effect on the next request. */
  async invalidate(kind: 'user' | 'service', ids: string[]): Promise<void> {
    await Promise.all(
      ids.map((id) =>
        this.cache.destroy(`${kind}:${id}`).catch((error: unknown) =>
          // The database is the source of truth and the TTL bounds the window,
          // so a failed delete degrades rather than breaks. And while Redis is
          // unreachable `assertLive` is rejecting everything anyway, so the
          // stale entry cannot actually be used.
          this.logger.warn(
            `Could not drop cached verdict for ${kind}:${id}; it lapses within ` +
              `${VERDICT_TTL_SECONDS}s: ${asMessage(error)}`,
          ),
        ),
      ),
    );
  }

  /**
   * A user token is keyed by its session, a service token by its credential.
   * A `user` token with no `sid` predates this mechanism and has no revocation
   * record at all — there is nothing to key it by, so it is refused.
   */
  private cacheKey(claims: AccessTokenClaims): string | null {
    if (claims.kind === 'user') {
      return claims.sid ? `user:${claims.sid}` : null;
    }
    return `service:${claims.sub}`;
  }

  /**
   * Fails CLOSED. A cache miss is normal and falls through to the database; a
   * cache *error* does not. Reading the database on a Redis failure would be a
   * silent fallback that quietly removes the cache from the security path, and
   * "we could not check" is not the same as "it is fine".
   */
  private async readCache(key: string): Promise<CachedVerdict | null> {
    try {
      return await this.cache.get<CachedVerdict>(key);
    } catch (error) {
      this.logger.error(
        `Token revocation check unavailable (cache read failed): ${asMessage(error)}`,
      );
      // 503, not 401: the token may well be valid — we cannot say. A 401 tells
      // an honest client to discard good credentials and re-authenticate, which
      // under a Redis outage stampedes argon2 hashing on the login path.
      throw this.errors.create(ErrorCode.CACHE_UNAVAILABLE);
    }
  }

  /** Best-effort: the verdict is already known, so a write failure is not fatal. */
  private async writeCache(key: string, live: boolean): Promise<void> {
    try {
      await this.cache.set(key, { live }, VERDICT_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Could not cache token verdict: ${asMessage(error)}`);
    }
  }

  private async readSource(claims: AccessTokenClaims): Promise<boolean> {
    if (claims.kind === 'service') {
      const credential = await this.credentials.findLiveById(claims.sub);
      if (!credential) return false;
      return (
        !credential.expiresAt || credential.expiresAt.getTime() > Date.now()
      );
    }

    // The lookup also requires the owning user to still be live — see
    // `SessionRepository.findLiveById`.
    return (await this.sessions.findLiveById(claims.sid as string)) !== null;
  }

  private dead(message: string) {
    return this.errors.create(ErrorCode.AUTH_TOKEN_INVALID, { message });
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
