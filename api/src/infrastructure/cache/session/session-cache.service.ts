import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { withTimeout } from '../../../common/with-timeout';
import type { RedisConfig } from '../../../config/configurations/redis.config';
import { REDIS_CLIENT } from '../redis.provider';

/**
 * Stores and retrieves session data in Redis. Keys are namespaced under
 * `session:` and carry a TTL.
 *
 * Consumed by `TokenValidityService` to cache the "is this token still good?"
 * verdict. Because the cache lives in shared Redis rather than in each
 * process's memory, deleting a key on revocation takes effect across every
 * instance at once — no pub/sub, unlike `IndexRegistry`, which caches locally.
 *
 * Every method rejects rather than hangs when Redis is unreachable; deciding
 * what that means is the caller's business (`TokenValidityService` fails
 * closed on a read, and shrugs at a failed write).
 */
@Injectable()
export class SessionCacheService {
  private readonly prefix = 'session:';

  /**
   * Ceiling on a single Redis round-trip.
   *
   * Load-bearing, not a nicety: while the server is unreachable ioredis can
   * **queue** a command rather than reject it, and this cache sits on the
   * authenticated request path, so an unguarded await would turn a Redis outage
   * into hung requests rather than failed ones.
   *
   * Read from config rather than compiled in, and deliberately the same value
   * the client itself is built with — see `redis.config.ts` for why a tighter
   * number here was reporting a busy event loop as an unreachable server.
   */
  private readonly commandTimeoutMs: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.commandTimeoutMs =
      config.getOrThrow<RedisConfig>('redis').commandTimeoutMs;
  }

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  /** Stores session data with a TTL (seconds). */
  async set(
    sessionId: string,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void> {
    await withTimeout(
      this.redis.set(
        this.key(sessionId),
        JSON.stringify(data),
        'EX',
        ttlSeconds,
      ),
      this.commandTimeoutMs,
    );
  }

  /** Returns parsed session data, or `null` if absent/expired. */
  async get<T = Record<string, unknown>>(sessionId: string): Promise<T | null> {
    const raw = await withTimeout(
      this.redis.get(this.key(sessionId)),
      this.commandTimeoutMs,
    );
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** Refreshes the TTL (seconds) on an existing session. */
  async touch(sessionId: string, ttlSeconds: number): Promise<void> {
    await withTimeout(
      this.redis.expire(this.key(sessionId), ttlSeconds),
      this.commandTimeoutMs,
    );
  }

  /** Removes a session (e.g. on logout or revocation). */
  async destroy(sessionId: string): Promise<void> {
    await withTimeout(
      this.redis.del(this.key(sessionId)),
      this.commandTimeoutMs,
    );
  }
}
