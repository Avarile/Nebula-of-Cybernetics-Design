import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { createHash } from 'node:crypto';
import { roleOf, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { FeatureFlagRow } from '../../infrastructure/database/schema/system.schema';
import type { UpsertFeatureFlagDto } from './dto/feature-flag.dto';
import { FeatureFlagRepository } from './feature-flag.repository';

/** Targeting rules stored in `feature_flags.rollout`. */
interface Rollout {
  userIds?: string[];
  roles?: string[];
  percentage?: number;
}

export interface PublicFeatureFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  rollout: Rollout;
  expiresAt: Date | null;
  expired: boolean;
}

/**
 * Staged rollout switches.
 *
 * Each capability module ships behind one, so a bad release is a toggle rather
 * than a rollback. Evaluation is cached in Redis-backed `CACHE_MANAGER`, which
 * every replica shares — a write deletes the key once and all instances see it,
 * so no pub/sub channel is needed (the same reasoning as `SessionCacheService`).
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  /** Short: a flag is a control surface, and staleness is measured in seconds. */
  private readonly ttlMs = 30_000;

  constructor(
    private readonly repo: FeatureFlagRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly errors: ExceptionService,
  ) {}

  private cacheKey(key: string): string {
    return `system:flag:${key}`;
  }

  private toPublic(row: FeatureFlagRow): PublicFeatureFlag {
    return {
      key: row.key,
      description: row.description ?? null,
      enabled: row.enabled,
      rollout: row.rollout as Rollout,
      expiresAt: row.expiresAt ?? null,
      // `!= null` rather than `!== null`: an absent column arrives as
      // `undefined`, which passes a strict null check and then throws on
      // `.getTime()`.
      expired: row.expiresAt != null && row.expiresAt.getTime() < Date.now(),
    };
  }

  /**
   * Whether a flag is on for this caller.
   *
   * Unknown flag → **false**. A typo in a flag name must disable the feature it
   * guards, not enable it; the opposite turns a misspelling into an unreviewed
   * release.
   */
  async isEnabled(key: string, principal?: Principal): Promise<boolean> {
    const flag = await this.read(key);
    if (!flag) {
      this.logger.debug(`Unknown feature flag "${key}" — treating as off`);
      return false;
    }
    if (!flag.enabled) return false;
    // An expired flag is off: the expiry exists to stop a temporary switch
    // becoming permanent configuration by neglect.
    if (flag.expired) return false;

    const { userIds, roles, percentage } = flag.rollout ?? {};
    const targeted =
      (userIds?.length ?? 0) > 0 ||
      (roles?.length ?? 0) > 0 ||
      percentage !== undefined;
    if (!targeted) return true;
    if (!principal) return false;

    if (principal.kind === 'user' && userIds?.includes(principal.userId)) {
      return true;
    }
    if (roles?.includes(roleOf(principal))) return true;
    if (percentage !== undefined && principal.kind === 'user') {
      return this.bucketOf(key, principal.userId) < percentage;
    }
    return false;
  }

  async list(): Promise<PublicFeatureFlag[]> {
    return (await this.repo.listAll()).map((r) => this.toPublic(r));
  }

  async get(key: string): Promise<PublicFeatureFlag> {
    const flag = await this.read(key);
    if (!flag) throw this.errors.create(ErrorCode.FEATURE_FLAG_NOT_FOUND);
    return flag;
  }

  async upsert(
    key: string,
    dto: UpsertFeatureFlagDto,
  ): Promise<PublicFeatureFlag> {
    const row = await this.repo.upsertByKey(key, {
      description: dto.description,
      enabled: dto.enabled,
      rollout: dto.rollout,
      expiresAt: dto.expiresAt,
    });
    await this.cache.del(this.cacheKey(key));
    this.logger.warn(
      `Feature flag "${key}" set to ${dto.enabled ? 'ENABLED' : 'disabled'}`,
    );
    return this.toPublic(row);
  }

  async remove(key: string): Promise<void> {
    const deleted = await this.repo.softDelete(key);
    if (!deleted) throw this.errors.create(ErrorCode.FEATURE_FLAG_NOT_FOUND);
    await this.cache.del(this.cacheKey(key));
  }

  private async read(key: string): Promise<PublicFeatureFlag | undefined> {
    const cached = await this.cache.get<PublicFeatureFlag>(this.cacheKey(key));
    if (cached) {
      // `expired` was computed when the entry was cached; recompute so a flag
      // cannot stay on for a TTL past its expiry.
      return {
        ...cached,
        expired:
          cached.expiresAt != null &&
          new Date(cached.expiresAt).getTime() < Date.now(),
      };
    }
    const row = await this.repo.findByKey(key);
    if (!row) return undefined;
    const pub = this.toPublic(row);
    await this.cache.set(this.cacheKey(key), pub, this.ttlMs);
    return pub;
  }

  /**
   * Stable 0–99 bucket for percentage rollouts.
   *
   * Hashed with the flag key so one user is not in the first percent of every
   * flag at once, and deterministic so a user does not flip between buckets on
   * consecutive requests.
   */
  private bucketOf(key: string, userId: string): number {
    const digest = createHash('sha256').update(`${key}:${userId}`).digest();
    return digest.readUInt32BE(0) % 100;
  }
}
