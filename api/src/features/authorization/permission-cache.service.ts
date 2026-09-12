import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import type { RedisConfig } from '../../config/configurations/redis.config';
import { REDIS_CLIENT } from '../../infrastructure/cache/redis.provider';

/** How long a resolved permission set may be reused. */
const TTL_SECONDS = 300;

const EPOCH_KEY = 'perm:epoch';

interface CachedSet {
  epoch: number;
  keys: string[];
}

/**
 * Caches resolved permission sets in Redis, invalidated by a global epoch.
 *
 * The obvious design — delete the affected keys on every grant change — cannot
 * express "this role changed, so every member's set is stale" without either a
 * `SCAN` over the keyspace or a fan-out job per member. A role with a thousand
 * members would put that loop inside the request that edited it.
 *
 * Instead every write bumps one counter. A cached set carries the epoch it was
 * built under, and any entry from an older epoch is ignored. Invalidating
 * everything therefore costs a single `INCR`, and is atomic across replicas.
 *
 * The read is a pipeline, so the epoch and the entry arrive in ONE round trip —
 * checking them separately would double the latency of every authorized request.
 */
@Injectable()
export class PermissionCacheService {
  private readonly logger = new Logger(PermissionCacheService.name);

  /**
   * Ceiling on one Redis round-trip; see `withTimeout` for why this is required
   * and `redis.config.ts` for why the number is configured rather than compiled
   * in. Abandoning a read that Redis would have answered is not free here: it
   * silently moves the authorization path back onto the database.
   */
  private readonly commandTimeoutMs: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.commandTimeoutMs =
      config.getOrThrow<RedisConfig>('redis').commandTimeoutMs;
  }

  private key(subject: string): string {
    return `perm:set:${subject}`;
  }

  /**
   * Returns the cached set, or null when absent, stale or unreachable.
   *
   * A Redis failure returns null rather than throwing: the caller falls back to
   * the database, which is correct and merely slower. Failing the request would
   * turn a cache outage into an authorization outage.
   */
  async get(subject: string): Promise<string[] | null> {
    try {
      const results = await withTimeout(
        this.redis.pipeline().get(EPOCH_KEY).get(this.key(subject)).exec(),
        this.commandTimeoutMs,
      );
      if (!results) return null;
      const [[, rawEpoch], [, rawEntry]] = results as [
        [Error | null, string | null],
        [Error | null, string | null],
      ];
      if (!rawEntry) return null;
      const entry = JSON.parse(rawEntry) as CachedSet;
      const epoch = Number(rawEpoch ?? 0);
      // Built before the last grant change: not wrong to have kept, wrong to use.
      if (entry.epoch !== epoch) return null;
      return entry.keys;
    } catch (error) {
      this.logger.warn(
        `Permission cache read failed, falling back to the database: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Store a resolved set stamped with the current epoch. */
  async set(subject: string, keys: string[]): Promise<void> {
    try {
      const epoch = Number(
        (await withTimeout(this.redis.get(EPOCH_KEY), this.commandTimeoutMs)) ??
          0,
      );
      const entry: CachedSet = { epoch, keys };
      await withTimeout(
        this.redis.set(
          this.key(subject),
          JSON.stringify(entry),
          'EX',
          TTL_SECONDS,
        ),
        this.commandTimeoutMs,
      );
    } catch (error) {
      // A failed cache write costs a database read next time. Nothing more.
      this.logger.debug(
        `Permission cache write skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Invalidate every cached set, everywhere, with one command.
   *
   * Called after any write to `user_roles`, `role_permissions`,
   * `user_permissions` or `users.role`. Deliberately global: a permission change
   * is rare and correctness here matters more than preserving warm entries.
   */
  async invalidateAll(): Promise<void> {
    try {
      await withTimeout(this.redis.incr(EPOCH_KEY), this.commandTimeoutMs);
    } catch (error) {
      // Failing to invalidate is the one failure that is NOT safe to swallow
      // silently: stale grants would survive for the TTL.
      this.logger.error(
        `Permission cache invalidation FAILED — grants may be stale for up to ` +
          `${TTL_SECONDS}s: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
