import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { TimeoutError } from '../../../common/with-timeout';
import { SessionCacheService } from './session-cache.service';

/** A Redis whose reply lands after `ms`, so the budget is what decides. */
function slowRedis(
  ms: number,
  reply: unknown = JSON.stringify({ live: true }),
) {
  return {
    get: jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(reply), ms)),
    ),
    set: jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve('OK'), ms)),
    ),
    del: jest.fn(() => new Promise((resolve) => setTimeout(resolve, ms))),
    expire: jest.fn(() => new Promise((resolve) => setTimeout(resolve, ms))),
  } as unknown as Redis;
}

function configWith(commandTimeoutMs: number): ConfigService {
  return {
    getOrThrow: () => ({
      host: 'localhost',
      port: 6379,
      db: 0,
      commandTimeoutMs,
    }),
  } as unknown as ConfigService;
}

describe('SessionCacheService', () => {
  it('takes its command budget from config, not a hardcoded constant', async () => {
    // The regression this guards: a budget baked into the source was sized for
    // a localhost Redis. Against a remote one it is the client, not Redis, that
    // decides the request fails — see the 200ms fail-closed 503s.
    // 250ms beats a 600ms budget but not the 200ms that used to be compiled in.
    const redis = slowRedis(250);
    const cache = new SessionCacheService(redis, configWith(600));

    await expect(cache.get('user:s1')).resolves.toEqual({ live: true });
  });

  it('still rejects rather than hangs once the budget is spent', async () => {
    // Load-bearing: ioredis queues commands while the server is unreachable, so
    // an unguarded await turns an outage into hung requests. The budget moved;
    // the guarantee did not.
    const redis = slowRedis(120);
    const cache = new SessionCacheService(redis, configWith(30));

    await expect(cache.get('user:s1')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('applies the same budget to writes', async () => {
    const redis = slowRedis(120);
    const cache = new SessionCacheService(redis, configWith(30));

    await expect(
      cache.set('user:s1', { live: true }, 30),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
