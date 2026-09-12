import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { PermissionCacheService } from './permission-cache.service';

/** A pipeline whose `exec` lands after `ms`, so the budget is what decides. */
function slowRedis(ms: number, epoch = '2', keys: string[] = ['users.read']) {
  const exec = jest.fn(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve([
              [null, epoch],
              [null, JSON.stringify({ epoch: Number(epoch), keys })],
            ]),
          ms,
        ),
      ),
  );
  const chain: { get: () => typeof chain; exec: typeof exec } = {
    get: jest.fn(() => chain),
    exec,
  };
  return { pipeline: jest.fn(() => chain) } as unknown as Redis;
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

describe('PermissionCacheService', () => {
  it('takes its command budget from config, not a hardcoded constant', async () => {
    // A cache read that the client abandons is a cache miss the database has to
    // serve. At 200ms compiled in, a healthy remote Redis was being abandoned
    // often enough to show up as load on the authorization path.
    const cache = new PermissionCacheService(slowRedis(250), configWith(600));

    await expect(cache.get('user:u1')).resolves.toEqual(['users.read']);
  });

  it('still falls back to the database once the budget is spent', async () => {
    // Failing the request would turn a cache outage into an authorization
    // outage; null means "ask the database", which is correct and merely slower.
    const cache = new PermissionCacheService(slowRedis(120), configWith(30));

    await expect(cache.get('user:u1')).resolves.toBeNull();
  });
});
