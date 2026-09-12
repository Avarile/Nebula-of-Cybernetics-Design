import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { SearchConfig } from '../../config/configurations/search.config';
import { withTimeout } from '../../common/with-timeout';
import { REDIS_CLIENT } from '../../infrastructure/cache/redis.provider';
import type {
  CollectionRow,
  CollectionVisibility,
  FieldSpec,
} from '../../infrastructure/database/schema/search.schema';
import type { IndexDefinition } from '../../infrastructure/search-engine/search-engine.interface';
import { CollectionRepository } from './collection.repository';
import { fieldSpecToIndexDefinition } from './document-validator';
import { REGISTRY_INVALIDATE_CHANNEL } from './search.constants';

/** A collection compiled for runtime use: config + derived Meili definition. */
export interface CompiledCollection {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  definition: IndexDefinition;
  /** Read policy — see `collectionVisibility`. Enforced by `SearchRecordService`. */
  visibility: CollectionVisibility;
  /** Document field holding the owning `users.id`; set iff `owner_scoped`. */
  ownerField: string | null;
}

interface CacheEntry {
  compiled: CompiledCollection;
  expiresAt: number;
}

/** Ceiling on the subscribe handshake, so a slow Redis cannot delay boot. */
const SUBSCRIBE_TIMEOUT_MS = 2_000;

/**
 * Cache of compiled collections over the `collections` table. A cache miss falls
 * back to the repository, so a collection created on another instance is
 * resolvable without a restart.
 *
 * The compiled field-spec drives write validation *and* the query filter/sort
 * allowlist, so a stale entry means two instances disagree about what is legal.
 * Coherence therefore has two layers:
 *  - `invalidate()` publishes on Redis, so every instance drops the entry within
 *    a round-trip of the mutation;
 *  - entries also carry a TTL, so a missed message (subscriber reconnecting,
 *    Redis restarted) self-heals within `registryTtlMs` instead of persisting
 *    until the next deploy.
 */
@Injectable()
export class IndexRegistry implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IndexRegistry.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private subscriber?: Redis;

  constructor(
    private readonly collections: CollectionRepository,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    config: ConfigService,
  ) {
    this.ttlMs = config.getOrThrow<SearchConfig>('search').registryTtlMs;
  }

  /**
   * Subscribe on a dedicated connection: an ioredis client in subscriber mode
   * rejects ordinary commands, so the shared client cannot be reused here.
   *
   * Best-effort and non-blocking. The bounded race is what keeps boot safe:
   * ioredis queues commands while disconnected and retries indefinitely, so a
   * plain `await subscribe()` against an unreachable Redis would hang startup,
   * and boot must never hard-require Redis.
   *
   * The offline queue is deliberately left enabled. Disabling it rejects the
   * subscribe outright whenever the socket has not finished connecting — which
   * is the common case at startup ("Stream isn't writeable"), so invalidation
   * would silently never be wired up. Queuing lets a normal startup race
   * resolve itself, and lets a subscription re-establish once Redis returns,
   * while the timeout below still bounds how long boot waits.
   *
   * A failure here leaves the TTL as the only coherence mechanism: degraded,
   * still correct.
   */
  async onModuleInit(): Promise<void> {
    if (!this.redis) {
      this.logger.warn(
        `No Redis client available; collection-registry coherence relies on the ${this.ttlMs}ms TTL alone`,
      );
      return;
    }
    try {
      const subscriber = this.redis.duplicate();
      this.subscriber = subscriber;
      subscriber.on('error', (error: Error) =>
        this.logger.warn(`Registry subscriber error: ${error.message}`),
      );
      subscriber.on('message', (channel: string, name: string) => {
        if (channel !== REGISTRY_INVALIDATE_CHANNEL) return;
        this.cache.delete(name);
      });
      await withTimeout(
        subscriber.subscribe(REGISTRY_INVALIDATE_CHANNEL),
        SUBSCRIBE_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Registry invalidation subscription unavailable, falling back to the ${this.ttlMs}ms TTL: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  onApplicationShutdown(): void {
    // `disconnect()` rather than `quit()`: it cannot block on an unreachable
    // server, and this connection only ever carried a subscription.
    this.subscriber?.disconnect();
    this.subscriber = undefined;
  }

  /** Resolve a collection by name (cache-first, repo fallback). */
  async resolve(name: string): Promise<CompiledCollection | null> {
    const cached = this.cache.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.compiled;
    const found = await this.collections.findByName(name);
    if (!found) {
      this.cache.delete(name);
      return null;
    }
    const compiled = compile(found);
    this.store(name, compiled);
    return compiled;
  }

  /**
   * Drop a cached entry locally and tell every other instance to do the same.
   * Callers await this, so the mutation that triggered it does not return until
   * the broadcast has been handed to Redis.
   */
  async invalidate(name: string): Promise<void> {
    this.cache.delete(name);
    if (!this.redis) return;
    try {
      await this.redis.publish(REGISTRY_INVALIDATE_CHANNEL, name);
    } catch (error) {
      this.logger.warn(
        `Could not broadcast invalidation for "${name}"; other instances will ` +
          `self-heal within ${this.ttlMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  /** Load and cache every active collection (boot warm-up). */
  async warm(): Promise<CompiledCollection[]> {
    const rows = await this.collections.listActive();
    this.cache.clear();
    const all: CompiledCollection[] = [];
    for (const row of rows) {
      const compiled = compile(row);
      this.store(row.name, compiled);
      all.push(compiled);
    }
    return all;
  }

  private store(name: string, compiled: CompiledCollection): void {
    this.cache.set(name, { compiled, expiresAt: Date.now() + this.ttlMs });
  }
}

function compile(row: CollectionRow): CompiledCollection {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    fields: row.fields,
    definition: fieldSpecToIndexDefinition(row.name, row.fields),
    visibility: row.visibility,
    ownerField: row.ownerField,
  };
}
