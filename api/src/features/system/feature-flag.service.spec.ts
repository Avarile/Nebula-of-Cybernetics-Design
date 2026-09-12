import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { FeatureFlagService } from './feature-flag.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };

function makeFlag(overrides: Record<string, any> = {}) {
  return {
    id: 'f1',
    key: 'module.crm',
    description: null,
    enabled: true,
    rollout: {},
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('FeatureFlagService', () => {
  let repo: any;
  let cache: any;
  let flags: FeatureFlagService;

  beforeEach(() => {
    repo = {
      findByKey: jest.fn(async () => makeFlag()),
      listAll: jest.fn(async () => [makeFlag()]),
      upsertByKey: jest.fn(async (key: string, p: any) =>
        makeFlag({ key, ...p }),
      ),
      softDelete: jest.fn(async () => true),
    };
    cache = {
      get: jest.fn(async () => undefined),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => true),
    };
    flags = new FeatureFlagService(repo, cache, new ExceptionService());
  });

  it('treats an unknown flag as off', async () => {
    // A typo in a flag name must disable the feature it guards, never enable it.
    repo.findByKey.mockResolvedValueOnce(null);
    await expect(flags.isEnabled('module.typo', user)).resolves.toBe(false);
  });

  it('is off when the global switch is off, whatever the targeting says', async () => {
    repo.findByKey.mockResolvedValueOnce(
      makeFlag({ enabled: false, rollout: { userIds: ['u1'] } }),
    );
    await expect(flags.isEnabled('module.crm', user)).resolves.toBe(false);
  });

  it('is on for everyone when enabled with no targeting', async () => {
    await expect(flags.isEnabled('module.crm', user)).resolves.toBe(true);
  });

  it('is off once expired, so a temporary switch cannot become permanent', async () => {
    repo.findByKey.mockResolvedValueOnce(
      makeFlag({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(flags.isEnabled('module.crm', user)).resolves.toBe(false);
  });

  it('does not let a cached entry outlive its expiry', async () => {
    cache.get.mockResolvedValueOnce({
      key: 'module.crm',
      description: null,
      enabled: true,
      rollout: {},
      expiresAt: new Date(Date.now() - 1000),
      expired: false, // stale value from when it was cached
    });
    await expect(flags.isEnabled('module.crm', user)).resolves.toBe(false);
  });

  describe('targeting', () => {
    it('matches an explicitly listed user', async () => {
      repo.findByKey.mockResolvedValue(
        makeFlag({ rollout: { userIds: ['u1'] } }),
      );
      await expect(flags.isEnabled('module.crm', user)).resolves.toBe(true);
      await expect(
        flags.isEnabled('module.crm', {
          kind: 'user',
          userId: 'u9',
          role: 'user',
        }),
      ).resolves.toBe(false);
    });

    it('matches by role', async () => {
      repo.findByKey.mockResolvedValue(
        makeFlag({ rollout: { roles: ['admin'] } }),
      );
      await expect(flags.isEnabled('module.crm', admin)).resolves.toBe(true);
      await expect(flags.isEnabled('module.crm', user)).resolves.toBe(false);
    });

    it('denies a targeted flag when there is no principal to target', async () => {
      repo.findByKey.mockResolvedValue(
        makeFlag({ rollout: { roles: ['admin'] } }),
      );
      await expect(flags.isEnabled('module.crm')).resolves.toBe(false);
    });

    it('buckets a user consistently across calls', async () => {
      repo.findByKey.mockResolvedValue(
        makeFlag({ rollout: { percentage: 50 } }),
      );
      const first = await flags.isEnabled('module.crm', user);
      cache.get.mockResolvedValue(undefined);
      const second = await flags.isEnabled('module.crm', user);
      expect(second).toBe(first);
    });

    it('includes everyone at 100 and nobody at 0', async () => {
      repo.findByKey.mockResolvedValue(
        makeFlag({ rollout: { percentage: 100 } }),
      );
      await expect(flags.isEnabled('module.crm', user)).resolves.toBe(true);
      repo.findByKey.mockResolvedValue(
        makeFlag({ rollout: { percentage: 0 } }),
      );
      await expect(flags.isEnabled('module.crm', user)).resolves.toBe(false);
    });
  });

  it('invalidates the shared cache on write, so every replica sees the change', async () => {
    await flags.upsert('module.crm', {
      enabled: true,
      rollout: {},
    } as never);
    expect(cache.del).toHaveBeenCalledWith('system:flag:module.crm');
  });

  it('404s on an unknown flag', async () => {
    repo.findByKey.mockResolvedValueOnce(null);
    await expect(flags.get('nope')).rejects.toMatchObject({
      code: ErrorCode.FEATURE_FLAG_NOT_FOUND,
    });
  });
});
