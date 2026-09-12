import type { CollectionRow } from '../../infrastructure/database/schema/search.schema';
import { IndexRegistry } from './index-registry';
import { REGISTRY_INVALIDATE_CHANNEL } from './search.constants';

function row(name: string): CollectionRow {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    description: null,
    fields: [{ name: 'title', type: 'string', searchable: true }],
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CollectionRow;
}

function makeRepo(rows: CollectionRow[]) {
  return {
    findByName: jest.fn(
      async (name: string) => rows.find((r) => r.name === name) ?? null,
    ),
    listActive: jest.fn(async () => rows),
  };
}

/** Captures the subscriber handler so tests can deliver a pub/sub message. */
function makeRedis() {
  const handlers: Record<string, (...args: string[]) => void> = {};
  const subscriber = {
    on: jest.fn((event: string, fn: (...args: string[]) => void) => {
      handlers[event] = fn;
    }),
    subscribe: jest.fn<Promise<unknown>, [string]>(async () => 1),
    disconnect: jest.fn(),
  };
  const redis = {
    duplicate: jest.fn<typeof subscriber, [unknown?]>(() => subscriber),
    publish: jest.fn(async () => 1),
  };
  return {
    redis,
    subscriber,
    deliver: (name: string) =>
      handlers.message?.(REGISTRY_INVALIDATE_CHANNEL, name),
  };
}

function make(rows: CollectionRow[], ttlMs = 60_000) {
  const repo = makeRepo(rows);
  const { redis, subscriber, deliver } = makeRedis();
  const config = { getOrThrow: () => ({ registryTtlMs: ttlMs }) };
  const reg = new IndexRegistry(repo as never, redis as never, config as never);
  return { reg, repo, redis, subscriber, deliver };
}

describe('IndexRegistry', () => {
  it('resolves from the repo on a cache miss and compiles a definition', async () => {
    const { reg, repo } = make([row('articles')]);
    const compiled = await reg.resolve('articles');
    expect(compiled?.definition.searchableAttributes).toEqual(['title']);
    expect(repo.findByName).toHaveBeenCalledTimes(1);
  });

  it('serves a second resolve from cache without hitting the repo again', async () => {
    const { reg, repo } = make([row('articles')]);
    await reg.resolve('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown collection', async () => {
    const { reg } = make([]);
    expect(await reg.resolve('nope')).toBeNull();
  });

  it('invalidate forces a recompile and broadcasts to other instances', async () => {
    const { reg, repo, redis } = make([row('articles')]);
    await reg.resolve('articles');
    await reg.invalidate('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(2);
    expect(redis.publish).toHaveBeenCalledWith(
      REGISTRY_INVALIDATE_CHANNEL,
      'articles',
    );
  });

  it('still invalidates locally when the broadcast fails', async () => {
    const { reg, repo, redis } = make([row('articles')]);
    redis.publish.mockRejectedValueOnce(new Error('redis down'));
    await reg.resolve('articles');
    await expect(reg.invalidate('articles')).resolves.toBeUndefined();
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(2);
  });

  it('drops an entry when another instance publishes an invalidation', async () => {
    const { reg, repo, deliver } = make([row('articles')]);
    await reg.onModuleInit();
    await reg.resolve('articles');
    deliver('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(2);
  });

  it('expires a cached entry once its TTL elapses', async () => {
    const { reg, repo } = make([row('articles')], 0);
    await reg.resolve('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(2);
  });

  it('falls back to the TTL when the subscription cannot be established', async () => {
    const { reg, redis } = make([row('articles')]);
    redis.duplicate.mockImplementationOnce(() => {
      throw new Error('no connection');
    });
    await expect(reg.onModuleInit()).resolves.toBeUndefined();
    expect(await reg.resolve('articles')).not.toBeNull();
  });

  // Boot must never hard-require Redis, so an unreachable one degrades to the
  // TTL rather than hanging on ioredis's offline command queue.
  it('does not block boot when the subscribe handshake never settles', async () => {
    const { reg, redis, subscriber } = make([row('articles')]);
    subscriber.subscribe.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    await expect(reg.onModuleInit()).resolves.toBeUndefined();
    expect(redis.duplicate).toHaveBeenCalled();
  }, 10_000);

  // Disabling ioredis's offline queue rejects the subscribe whenever the socket
  // has not finished connecting — the common case at startup — so invalidation
  // would silently never be wired up. Queuing plus the timeout is the safe pair.
  it('keeps the offline queue so a startup connect race still subscribes', async () => {
    const { reg, redis, subscriber } = make([row('articles')]);
    await reg.onModuleInit();
    expect(redis.duplicate).toHaveBeenCalledWith();
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      REGISTRY_INVALIDATE_CHANNEL,
    );
  });

  it('works with no Redis client at all, on the TTL alone', async () => {
    const repo = makeRepo([row('articles')]);
    const config = { getOrThrow: () => ({ registryTtlMs: 60_000 }) };
    const reg = new IndexRegistry(repo as never, null, config as never);
    await expect(reg.onModuleInit()).resolves.toBeUndefined();
    expect(await reg.resolve('articles')).not.toBeNull();
    await expect(reg.invalidate('articles')).resolves.toBeUndefined();
  });

  it('closes the subscriber on shutdown', async () => {
    const { reg, subscriber } = make([row('articles')]);
    await reg.onModuleInit();
    reg.onApplicationShutdown();
    expect(subscriber.disconnect).toHaveBeenCalled();
  });

  it('warm loads and caches every active collection', async () => {
    const { reg, repo } = make([row('a'), row('b')]);
    const all = await reg.warm();
    expect(all).toHaveLength(2);
    await reg.resolve('a');
    expect(repo.findByName).not.toHaveBeenCalled();
  });
});
