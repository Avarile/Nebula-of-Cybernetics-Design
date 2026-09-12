import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { UsersService } from './users.service';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'u1',
    email: 'a@b.co',
    passwordHash: 'HASH',
    role: 'user',
    displayName: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    lastLoginAt: null,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('UsersService', () => {
  let repo: any;
  let passwords: any;
  let revocation: any;
  let permissionCache: any;
  let permissions: any;
  let service: UsersService;

  beforeEach(() => {
    repo = {
      findByEmail: jest.fn(async () => null),
      findActiveById: jest.fn(async () => makeRow()),
      create: jest.fn(async (v: any) => makeRow(v)),
      update: jest.fn(async (id: string, patch: any) =>
        makeRow({ id, ...patch }),
      ),
      softDelete: jest.fn(async () => undefined),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
    };
    passwords = { hash: jest.fn(async () => 'HASH') };
    revocation = { revokeAllForUser: jest.fn(async () => undefined) };
    permissionCache = { invalidateAll: jest.fn(async () => undefined) };
    permissions = {
      findRoleByKey: jest.fn(async (key: string) => ({
        id: `role-${key}`,
        key,
      })),
      grantRole: jest.fn(async () => undefined),
      revokeRole: jest.fn(async () => true),
    };
    service = new UsersService(
      repo,
      passwords,
      revocation,
      permissionCache,
      permissions,
      new ExceptionService(),
    );
  });

  it('creates a user: lowercases email, hashes password, strips the hash', async () => {
    const user = await service.create({
      email: 'MixedCase@B.co',
      password: 'a-very-strong-pass',
      role: 'user',
    });
    expect(passwords.hash).toHaveBeenCalledWith('a-very-strong-pass');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'mixedcase@b.co',
        passwordHash: 'HASH',
      }),
    );
    expect((user as any).passwordHash).toBeUndefined();
    expect(user.email).toBe('mixedcase@b.co');
  });

  it('rejects a duplicate email', async () => {
    repo.findByEmail.mockResolvedValueOnce(makeRow());
    await expect(
      service.create({
        email: 'a@b.co',
        password: 'a-very-strong-pass',
        role: 'user',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_EMAIL_TAKEN });
  });

  it('404s when updating a missing user', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(
      service.update('nope', { role: 'admin' }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
  });

  it('soft-deletes an existing user', async () => {
    await service.remove('u1');
    expect(repo.softDelete).toHaveBeenCalledWith('u1');
  });

  describe('UsersService revocation triggers', () => {
    // Before this, neither of these paths revoked anything at all — not even the
    // refresh sessions. `PATCH /users/:id {password}` and `PATCH /auth/password`
    // are the same change by two routes, and only one of them logged the user out.
    it('revokes every session when an admin changes a role', async () => {
      await service.update('u1', { role: 'admin' });
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    it('revokes every session when an admin resets a password', async () => {
      await service.update('u1', { password: 'a-new-password-1234' });
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    it('revokes every session on soft-delete', async () => {
      await service.remove('u1');
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    // Not security-relevant, so it should not log anyone out of every device.
    it('does not revoke on a display-name edit', async () => {
      await service.update('u1', { displayName: 'New Name' });
      expect(revocation.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
  describe('role assignment', () => {
    // A provisioned account used to get `users.role` and nothing else, while
    // the resolver read grants exclusively from `user_roles` — so every new
    // account resolved to zero permissions and could not create a contact, a
    // knowledge record or a task until an admin granted the role by hand.
    it('grants the matching role row when an account is provisioned', async () => {
      await service.create({
        email: 'new@b.co',
        password: 'a-very-strong-pass',
        role: 'user',
      });
      expect(permissions.findRoleByKey).toHaveBeenCalledWith('user');
      expect(permissions.grantRole).toHaveBeenCalledWith(
        'u1',
        'role-user',
        null,
        null,
      );
      expect(permissionCache.invalidateAll).toHaveBeenCalled();
    });

    it('grants the admin role row when an admin is provisioned', async () => {
      repo.create.mockResolvedValueOnce(makeRow({ role: 'admin' }));
      await service.create({
        email: 'boss@b.co',
        password: 'a-very-strong-pass',
        role: 'admin',
      });
      expect(permissions.grantRole).toHaveBeenCalledWith(
        'u1',
        'role-admin',
        null,
        null,
      );
    });

    // The account is already committed by this point; failing the request would
    // tell the caller nothing happened when in fact a user now exists.
    it('does not fail provisioning when the role is not seeded', async () => {
      permissions.findRoleByKey.mockResolvedValueOnce(null);
      await expect(
        service.create({
          email: 'new@b.co',
          password: 'a-very-strong-pass',
          role: 'user',
        }),
      ).resolves.toMatchObject({ email: 'new@b.co' });
      expect(permissions.grantRole).not.toHaveBeenCalled();
    });

    it('moves the role row when an admin promotes a user', async () => {
      repo.findActiveById.mockResolvedValueOnce(makeRow({ role: 'user' }));
      await service.update('u1', { role: 'admin' });
      expect(permissions.revokeRole).toHaveBeenCalledWith('u1', 'role-user');
      expect(permissions.grantRole).toHaveBeenCalledWith(
        'u1',
        'role-admin',
        null,
        null,
      );
    });

    it('moves the role row back on demotion', async () => {
      repo.findActiveById.mockResolvedValueOnce(makeRow({ role: 'admin' }));
      repo.update.mockResolvedValueOnce(makeRow({ role: 'user' }));
      await service.update('u1', { role: 'user' });
      expect(permissions.revokeRole).toHaveBeenCalledWith('u1', 'role-admin');
      expect(permissions.grantRole).toHaveBeenCalledWith(
        'u1',
        'role-user',
        null,
        null,
      );
    });

    // Re-granting a role the user already holds would reset an expiry an
    // administrator set deliberately.
    it('leaves the role row alone when the role does not change', async () => {
      repo.findActiveById.mockResolvedValueOnce(makeRow({ role: 'user' }));
      await service.update('u1', { role: 'user' });
      expect(permissions.revokeRole).not.toHaveBeenCalled();
      expect(permissions.grantRole).not.toHaveBeenCalled();
    });

    it('does not touch role rows on a display-name edit', async () => {
      await service.update('u1', { displayName: 'New Name' });
      expect(permissions.grantRole).not.toHaveBeenCalled();
      expect(permissions.revokeRole).not.toHaveBeenCalled();
    });
  });
});
