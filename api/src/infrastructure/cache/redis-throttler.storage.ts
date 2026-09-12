import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';

/**
 * Redis-backed `ThrottlerStorage`.
 *
 * The default storage is an in-process `Map`, so with N replicas the effective
 * limit was N × `THROTTLE_LIMIT` and it reset on every deploy. That matters most
 * for the endpoints that deliberately carry tight limits — `POST /auth/login`
 * (5/min), `/auth/forgot-password` (3/15min), `/auth/service-token` (10/min) —
 * i.e. exactly the credential-brute-force surface.
 *
 * Implemented against the existing shared `REDIS_CLIENT` rather than pulling in
 * a package: the interface is one method, and the app already owns a Redis
 * connection, a shutdown lifecycle and a health check for it.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly prefix = 'throttle:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Count one hit and report the window state.
   *
   * `INCR` + conditional `PEXPIRE` in a single pipeline so the counter and its
   * TTL are set together — two round trips would let a crash between them leave
   * a counter with no expiry, i.e. a key that throttles that caller forever.
   * The TTL is only set when `INCR` returns 1 (the window's first hit), so a
   * steady stream of requests cannot keep pushing the window out.
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `${this.prefix}${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockTtl / 1000),
      };
    }

    const results = await this.redis.multi().incr(hitKey).pttl(hitKey).exec();

    const totalHits = Number(results?.[0]?.[1] ?? 0);
    let remainingMs = Number(results?.[1]?.[1] ?? -1);

    if (totalHits === 1 || remainingMs < 0) {
      await this.redis.pexpire(hitKey, ttl);
      remainingMs = ttl;
    }

    if (totalHits > limit) {
      // Past the limit: start (or keep) the block window, so the caller is
      // refused for `blockDuration` rather than merely until the counter lapses.
      await this.redis.set(blockKey, '1', 'PX', blockDuration, 'NX');
      const ttlMs = await this.redis.pttl(blockKey);
      return {
        totalHits,
        timeToExpire: Math.ceil(remainingMs / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(Math.max(ttlMs, 0) / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(remainingMs / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
