import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Minimal ioredis double. `multi()` returns a chainable pipeline whose `exec`
 * resolves to ioredis' `[err, value][]` shape.
 */
function makeRedis(over: Partial<Record<string, unknown>> = {}) {
  const state = { hits: 0, hitTtlMs: -1, blockTtlMs: -1 };
  const redis = {
    __state: state,
    pttl: jest.fn(async (key: string) =>
      key.endsWith(':blocked') ? state.blockTtlMs : state.hitTtlMs,
    ),
    pexpire: jest.fn(async (_key: string, ms: number) => {
      state.hitTtlMs = ms;
      return 1;
    }),
    set: jest.fn(async () => 'OK'),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => [
        [null, ++state.hits],
        [null, state.hitTtlMs],
      ]),
    })),
    ...over,
  };
  return { redis, state };
}

const TTL = 60_000;
const LIMIT = 3;
const BLOCK = 30_000;

const hit = (storage: RedisThrottlerStorage, key = 'ip-1') =>
  storage.increment(key, TTL, LIMIT, BLOCK, 'default');

describe('RedisThrottlerStorage', () => {
  it('counts hits within the window', async () => {
    const { redis } = makeRedis();
    const storage = new RedisThrottlerStorage(redis as never);
    expect((await hit(storage)).totalHits).toBe(1);
    expect((await hit(storage)).totalHits).toBe(2);
  });

  // Counter and TTL must be established together; a counter that never expires
  // would throttle that caller permanently.
  it('sets the window TTL on the first hit', async () => {
    const { redis } = makeRedis();
    const storage = new RedisThrottlerStorage(redis as never);
    await hit(storage);
    expect(redis.pexpire).toHaveBeenCalledWith('throttle:default:ip-1', TTL);
  });

  it('does not extend the window on subsequent hits', async () => {
    const { redis } = makeRedis();
    const storage = new RedisThrottlerStorage(redis as never);
    await hit(storage);
    redis.pexpire.mockClear();
    await hit(storage);
    // A sliding TTL would let a steady stream of requests push the window out
    // forever and never reset the counter.
    expect(redis.pexpire).not.toHaveBeenCalled();
  });

  it('blocks once the limit is exceeded', async () => {
    const { redis, state } = makeRedis();
    const storage = new RedisThrottlerStorage(redis as never);
    for (let i = 0; i < LIMIT; i++)
      expect((await hit(storage)).isBlocked).toBe(false);
    state.blockTtlMs = BLOCK;
    const over = await hit(storage);
    expect(over.isBlocked).toBe(true);
    expect(over.totalHits).toBeGreaterThan(LIMIT);
  });

  it('short-circuits while a block is still in force', async () => {
    const { redis, state } = makeRedis();
    state.blockTtlMs = 10_000;
    const storage = new RedisThrottlerStorage(redis as never);
    const res = await hit(storage);
    expect(res.isBlocked).toBe(true);
    expect(res.timeToBlockExpire).toBe(10);
    // No counting while blocked — the pipeline is never reached.
    expect(redis.multi).not.toHaveBeenCalled();
  });

  it('namespaces by throttler name and key, so limits do not collide', async () => {
    const { redis } = makeRedis();
    const storage = new RedisThrottlerStorage(redis as never);
    await storage.increment('ip-1', TTL, LIMIT, BLOCK, 'login');
    expect(redis.pttl).toHaveBeenCalledWith('throttle:login:ip-1:blocked');
  });

  it('re-arms a TTL that has gone missing', async () => {
    const { redis, state } = makeRedis();
    state.hits = 5; // pre-existing counter…
    state.hitTtlMs = -1; // …with no expiry set
    const storage = new RedisThrottlerStorage(redis as never);
    await hit(storage);
    expect(redis.pexpire).toHaveBeenCalled();
  });
});
