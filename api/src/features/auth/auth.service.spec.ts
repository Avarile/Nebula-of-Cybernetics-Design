import type { UserRow } from '../../infrastructure/database/schema/identity.schema';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { AuthService } from './auth.service';

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    email: 'a@b.co',
    passwordHash: 'HASH',
    role: 'user',
    displayName: null,
    lastLoginAt: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let users: any;
  let sessions: any;
  let tokens: any;
  let passwords: any;
  let revocation: any;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(async () => makeUser()),
      findActiveById: jest.fn(async () => makeUser()),
      stampLogin: jest.fn(async () => undefined),
      update: jest.fn(async () => makeUser()),
    };
    sessions = {
      create: jest.fn(async () => ({ id: 's1' })),
      findByTokenHash: jest.fn(),
      revokeById: jest.fn(async () => undefined),
      revokeFamily: jest.fn(async () => undefined),
      revokeAllForUser: jest.fn(async () => undefined),
      listActiveForUser: jest.fn(async () => []),
    };
    tokens = {
      newFamilyId: jest.fn(() => 'fam-1'),
      signAccessToken: jest.fn(() => 'access.jwt'),
      generateRefreshToken: jest.fn(() => ({
        token: 'refresh-raw',
        tokenHash: 'HHH',
      })),
      hashToken: jest.fn((t: string) => `hash(${t})`),
      refreshExpiry: jest.fn(() => new Date(Date.now() + 1000)),
      accessTtl: jest.fn(() => 900),
    };
    passwords = {
      verify: jest.fn(async () => true),
      hash: jest.fn(async () => 'NEWHASH'),
      verifyDecoy: jest.fn(async () => undefined),
    };
    revocation = {
      revokeSession: jest.fn(async () => undefined),
      claimForRotation: jest.fn(async () => true),
      revokeFamily: jest.fn(async () => undefined),
      revokeAllForUser: jest.fn(async () => undefined),
    };
    service = new AuthService(
      users,
      sessions,
      revocation,
      tokens,
      passwords,
      new ExceptionService(),
    );
  });

  describe('validateUser', () => {
    it('returns the user on valid credentials', async () => {
      await expect(service.validateUser('a@b.co', 'pw')).resolves.toEqual(
        makeUser(),
      );
    });
    it('throws 401 when the user is unknown', async () => {
      users.findByEmail.mockResolvedValueOnce(null);
      const result = service.validateUser('x@y.z', 'pw');
      await expect(result).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
      await expect(result).rejects.toThrow('Invalid credentials');
    });
    it('throws 401 when the password is wrong', async () => {
      passwords.verify.mockResolvedValueOnce(false);
      const result = service.validateUser('a@b.co', 'bad');
      await expect(result).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
      await expect(result).rejects.toThrow('Invalid credentials');
    });
    it('throws 401 (not a TypeError) when email is not a string', async () => {
      const result = service.validateUser(['a@b.co'] as any, 'pw');
      await expect(result).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
      await expect(result).rejects.toThrow('Invalid credentials');
    });
  });

  describe('getProfile', () => {
    it('enriches the principal with email and display name from the DB', async () => {
      users.findActiveById.mockResolvedValueOnce(
        makeUser({
          id: 'u1',
          role: 'admin',
          email: 'jane@acme.com',
          displayName: 'Jane Doe',
        }),
      );
      await expect(
        service.getProfile({ kind: 'user', userId: 'u1', role: 'admin' }),
      ).resolves.toEqual({
        id: 'u1',
        kind: 'user',
        role: 'admin',
        email: 'jane@acme.com',
        displayName: 'Jane Doe',
      });
    });

    it('returns the bare principal for a non-user caller (no users row)', async () => {
      users.findActiveById.mockResolvedValueOnce(null);
      await expect(
        service.getProfile({
          kind: 'service',
          credentialId: 'svc-1',
          role: 'agent',
        }),
      ).resolves.toEqual({
        id: 'svc-1',
        kind: 'service',
        role: 'agent',
      });
    });

    it('returns the bare principal for the system caller (id === null)', async () => {
      await expect(service.getProfile({ kind: 'system' })).resolves.toEqual({
        id: null,
        kind: 'system',
        role: 'agent',
      });
      expect(users.findActiveById).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues a pair, persists a session, and stamps login', async () => {
      const pair = await service.login(makeUser(), { ip: '1.2.3.4' });
      expect(pair).toEqual({
        accessToken: 'access.jwt',
        refreshToken: 'refresh-raw',
        expiresIn: 900,
      });
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          tokenHash: 'HHH',
          familyId: 'fam-1',
        }),
      );
      expect(users.stampLogin).toHaveBeenCalledWith('u1');
    });
  });

  describe('refresh', () => {
    it('rotates a valid refresh token (revoke old, issue new in same family)', async () => {
      sessions.findByTokenHash.mockResolvedValueOnce({
        id: 's1',
        userId: 'u1',
        familyId: 'fam-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      });
      const pair = await service.refresh('refresh-raw', {});
      expect(revocation.claimForRotation).toHaveBeenCalledWith('s1');
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
      );
      expect(pair.accessToken).toBe('access.jwt');
      expect(revocation.revokeFamily).not.toHaveBeenCalled();
    });

    it('detects reuse: revokes the whole family and throws 401', async () => {
      sessions.findByTokenHash.mockResolvedValueOnce({
        id: 's1',
        userId: 'u1',
        familyId: 'fam-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      });
      await expect(service.refresh('refresh-raw', {})).rejects.toMatchObject({
        code: ErrorCode.AUTH_TOKEN_REUSE,
      });
      expect(revocation.revokeFamily).toHaveBeenCalledWith('fam-1');
    });

    it('throws 401 for an unknown refresh token', async () => {
      sessions.findByTokenHash.mockResolvedValueOnce(null);
      await expect(service.refresh('nope', {})).rejects.toMatchObject({
        code: ErrorCode.AUTH_TOKEN_INVALID,
      });
    });
  });

  describe('changePassword', () => {
    it('updates the hash and revokes all sessions', async () => {
      await service.changePassword('u1', 'current', 'new-strong-password');
      expect(users.update).toHaveBeenCalledWith('u1', {
        passwordHash: 'NEWHASH',
      });
      expect(revocation.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
    it('throws 401 when the current password is wrong', async () => {
      passwords.verify.mockResolvedValueOnce(false);
      const result = service.changePassword(
        'u1',
        'wrong',
        'new-strong-password',
      );
      await expect(result).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
      await expect(result).rejects.toThrow('Current password is incorrect');
    });
  });
  describe('credential-enumeration resistance', () => {
    // Argon2id is deliberately expensive. Skipping it for a missing account
    // made "unknown email" answer an order of magnitude faster than "wrong
    // password" — measurable over the network, and a user-enumeration oracle.
    it('spends the same hashing work when the account does not exist', async () => {
      users.findByEmail.mockResolvedValueOnce(null);
      await expect(
        service.validateUser('nobody@x.co', 'pw'),
      ).rejects.toBeDefined();
      expect(passwords.verifyDecoy).toHaveBeenCalledWith('pw');
    });

    it('does not call the decoy when the account exists', async () => {
      users.findByEmail.mockResolvedValueOnce({ id: 'u1', passwordHash: 'H' });
      await service.validateUser('someone@x.co', 'pw');
      expect(passwords.verifyDecoy).not.toHaveBeenCalled();
    });

    it('returns the same error for both failure modes', async () => {
      users.findByEmail.mockResolvedValueOnce(null);
      const unknown = await service
        .validateUser('nobody@x.co', 'pw')
        .catch((e: { code: string }) => e.code);
      users.findByEmail.mockResolvedValueOnce({ id: 'u1', passwordHash: 'H' });
      passwords.verify.mockResolvedValueOnce(false);
      const wrongPw = await service
        .validateUser('someone@x.co', 'bad')
        .catch((e: { code: string }) => e.code);
      expect(unknown).toBe(wrongPw);
    });
  });

  describe('refresh rotation atomicity', () => {
    // Both halves of a concurrent pair used to pass the `revokedAt` check and
    // both mint a token pair, splitting the family into two live lineages —
    // exactly the state reuse detection exists to catch.
    it('refuses when another request already claimed the rotation', async () => {
      revocation.claimForRotation.mockResolvedValueOnce(false);
      await expect(service.refresh('tok', {})).rejects.toMatchObject({
        code: ErrorCode.AUTH_TOKEN_INVALID,
      });
    });

    it('does not issue a second pair for a lost race', async () => {
      revocation.claimForRotation.mockResolvedValueOnce(false);
      await service.refresh('tok', {}).catch(() => undefined);
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });
});
