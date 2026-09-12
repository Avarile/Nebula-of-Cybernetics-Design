import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import { PermissionResolver } from './permission-resolver.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'c1',
  role: 'agent',
};

describe('PermissionResolver', () => {
  let repo: any;
  let cache: any;
  let resolver: PermissionResolver;

  beforeEach(() => {
    repo = {
      permissionKeysForUser: jest.fn(async () => ['project.read']),
      permissionKeysForRoleKey: jest.fn(async () => ['project.read']),
      overridesForUser: jest.fn(async () => []),
      allPermissionKeys: jest.fn(async () => [
        'project.read',
        'system.audit.read',
      ]),
    };
    cache = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      invalidateAll: jest.fn(async () => undefined),
    };
    resolver = new PermissionResolver(repo, cache);
  });

  describe('short-circuits', () => {
    it('grants an admin everything without consulting grants', async () => {
      await expect(resolver.can(admin, 'anything.at.all')).resolves.toBe(true);
      expect(repo.permissionKeysForUser).not.toHaveBeenCalled();
      expect(cache.get).not.toHaveBeenCalled();
    });

    it('grants the system principal, which is privileged but not an admin', async () => {
      await expect(
        resolver.can(SYSTEM_PRINCIPAL, 'project.read'),
      ).resolves.toBe(true);
    });

    it('denies an anonymous caller', async () => {
      await expect(resolver.can(GUEST_PRINCIPAL, 'project.read')).resolves.toBe(
        false,
      );
    });
  });

  describe('users', () => {
    it('grants what a role carries', async () => {
      await expect(resolver.can(user, 'project.read')).resolves.toBe(true);
      await expect(resolver.can(user, 'finance.read')).resolves.toBe(false);
    });

    it('adds an allow override', async () => {
      repo.overridesForUser.mockResolvedValue([
        { key: 'finance.read', effect: 'allow' },
      ]);
      await expect(resolver.can(user, 'finance.read')).resolves.toBe(true);
    });

    it('lets deny beat a role grant', async () => {
      repo.overridesForUser.mockResolvedValue([
        { key: 'project.read', effect: 'deny' },
      ]);
      await expect(resolver.can(user, 'project.read')).resolves.toBe(false);
    });

    it('lets deny beat an allow override, whatever order they arrive in', async () => {
      // Set union then set difference: the answer must not depend on row order.
      repo.overridesForUser.mockResolvedValue([
        { key: 'finance.read', effect: 'deny' },
        { key: 'finance.read', effect: 'allow' },
      ]);
      await expect(resolver.can(user, 'finance.read')).resolves.toBe(false);

      repo.overridesForUser.mockResolvedValue([
        { key: 'finance.read', effect: 'allow' },
        { key: 'finance.read', effect: 'deny' },
      ]);
      await expect(resolver.can(user, 'finance.read')).resolves.toBe(false);
    });
  });

  describe('service credentials', () => {
    it('resolves by role key, since a credential has no user_roles', async () => {
      await expect(resolver.can(service, 'project.read')).resolves.toBe(true);
      expect(repo.permissionKeysForRoleKey).toHaveBeenCalledWith('agent');
      expect(repo.permissionKeysForUser).not.toHaveBeenCalled();
    });

    it('caches under the role, not a user id', async () => {
      await resolver.can(service, 'project.read');
      expect(cache.set).toHaveBeenCalledWith('role:agent', ['project.read']);
    });
  });

  describe('caching', () => {
    it('uses a cached set without touching the database', async () => {
      cache.get.mockResolvedValueOnce(['finance.read']);
      await expect(resolver.can(user, 'finance.read')).resolves.toBe(true);
      expect(repo.permissionKeysForUser).not.toHaveBeenCalled();
    });

    it('falls back to the database when the cache is unreachable', async () => {
      // A cache outage must not become an authorization outage.
      cache.get.mockResolvedValueOnce(null);
      await expect(resolver.can(user, 'project.read')).resolves.toBe(true);
      expect(repo.permissionKeysForUser).toHaveBeenCalled();
    });

    it('stores what it resolved, keyed by user', async () => {
      await resolver.can(user, 'project.read');
      expect(cache.set).toHaveBeenCalledWith('user:u1', ['project.read']);
    });
  });
});
