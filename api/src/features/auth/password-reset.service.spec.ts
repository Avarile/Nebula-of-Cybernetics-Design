import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { PasswordResetService } from './password-reset.service';

function makeConfig() {
  return {
    getOrThrow: () => ({
      passwordReset: {
        pepper: 'p',
        codeTtlSeconds: 900,
        maxAttempts: 5,
        codeLength: 6,
      },
    }),
  } as any;
}

const user = { id: 'u1', email: 'user@example.com', passwordHash: 'old' };

describe('PasswordResetService', () => {
  let users: any;
  let codes: any;
  let sessions: any;
  let passwords: any;
  let hasher: any;
  let mailer: any;
  let service: PasswordResetService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(async () => user),
      update: jest.fn(async () => user),
    };
    codes = {
      consumeAllForUser: jest.fn(async () => undefined),
      insert: jest.fn(async () => ({ id: 'c1' })),
      findLiveByUser: jest.fn(async () => ({
        id: 'c1',
        codeHash: 'HASH',
        expiresAt: new Date(Date.now() + 60_000),
        attemptCount: 0,
      })),
      incrementAttempts: jest.fn(async () => 1),
      consume: jest.fn(async () => undefined),
    };
    sessions = { revokeAllForUser: jest.fn(async () => undefined) };
    passwords = { hash: jest.fn(async () => 'new-hash') };
    hasher = {
      generate: jest.fn(() => '482913'),
      hash: jest.fn(() => 'HASH'),
      verify: jest.fn(() => true),
    };
    mailer = {
      sendCode: jest.fn(async () => undefined),
      sendChangedConfirmation: jest.fn(async () => undefined),
    };
    service = new PasswordResetService(
      users,
      codes,
      sessions,
      passwords,
      hasher,
      mailer,
      makeConfig(),
      new ExceptionService(),
    );
  });

  // --- request ---

  it('request issues + emails a code for a known user', async () => {
    await service.request('User@Example.com');
    expect(users.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(codes.consumeAllForUser).toHaveBeenCalledWith('u1');
    expect(codes.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', codeHash: 'HASH' }),
    );
    expect(mailer.sendCode).toHaveBeenCalledWith('user@example.com', '482913');
  });

  it('request is a no-op for an unknown email (no throw, no code, no mail)', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.request('nobody@example.com'),
    ).resolves.toBeUndefined();
    expect(codes.consumeAllForUser).not.toHaveBeenCalled();
    expect(codes.insert).not.toHaveBeenCalled();
    expect(mailer.sendCode).not.toHaveBeenCalled();
  });

  it('request still resolves when sending mail throws (best-effort)', async () => {
    mailer.sendCode.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.request('user@example.com')).resolves.toBeUndefined();
    expect(codes.insert).toHaveBeenCalled();
  });

  // --- reset ---

  it('reset succeeds: sets password, burns code, revokes sessions, confirms', async () => {
    await service.reset('user@example.com', '482913', 'a-strong-password');
    expect(hasher.verify).toHaveBeenCalledWith('482913', 'HASH');
    expect(passwords.hash).toHaveBeenCalledWith('a-strong-password');
    expect(users.update).toHaveBeenCalledWith('u1', {
      passwordHash: 'new-hash',
    });
    expect(codes.consume).toHaveBeenCalledWith('c1');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
    expect(mailer.sendChangedConfirmation).toHaveBeenCalledWith(
      'user@example.com',
    );
    // Lock the success-path ORDER: a reorder that revoked sessions before
    // persisting the password (or confirmed before revoking, etc.) must fail.
    expect(passwords.hash.mock.invocationCallOrder[0]).toBeLessThan(
      users.update.mock.invocationCallOrder[0],
    );
    expect(users.update.mock.invocationCallOrder[0]).toBeLessThan(
      codes.consume.mock.invocationCallOrder[0],
    );
    expect(codes.consume.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.revokeAllForUser.mock.invocationCallOrder[0],
    );
    expect(sessions.revokeAllForUser.mock.invocationCallOrder[0]).toBeLessThan(
      mailer.sendChangedConfirmation.mock.invocationCallOrder[0],
    );
  });

  it('reset throws 401 for an unknown email and does equalizing HMAC work', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.reset('nobody@example.com', '482913', 'a-strong-password'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_RESET_CODE_INVALID });
    expect(hasher.verify).toHaveBeenCalled(); // decoy comparison ran
    expect(users.update).not.toHaveBeenCalled();
  });

  it('reset throws 401 when there is no live code', async () => {
    codes.findLiveByUser.mockResolvedValueOnce(null);
    await expect(
      service.reset('user@example.com', '482913', 'a-strong-password'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_RESET_CODE_INVALID });
    expect(hasher.verify).toHaveBeenCalledWith(
      expect.any(String),
      '0'.repeat(64),
    ); // equalizing decoy comparison ran
  });

  it('reset throws 401 when the code is expired', async () => {
    codes.findLiveByUser.mockResolvedValueOnce({
      id: 'c1',
      codeHash: 'HASH',
      expiresAt: new Date(Date.now() - 1000),
      attemptCount: 0,
    });
    await expect(
      service.reset('user@example.com', '482913', 'a-strong-password'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_RESET_CODE_INVALID });
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(hasher.verify).toHaveBeenCalledWith(
      expect.any(String),
      '0'.repeat(64),
    ); // equalizing decoy comparison ran
  });

  it('reset on a wrong code increments attempts and throws', async () => {
    hasher.verify.mockReturnValueOnce(false);
    await expect(
      service.reset('user@example.com', '000000', 'a-strong-password'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_RESET_CODE_INVALID });
    expect(codes.incrementAttempts).toHaveBeenCalledWith('c1');
    expect(codes.consume).not.toHaveBeenCalled();
  });

  it('reset burns the code on the final (5th) wrong attempt', async () => {
    hasher.verify.mockReturnValueOnce(false);
    codes.incrementAttempts.mockResolvedValueOnce(5);
    await expect(
      service.reset('user@example.com', '000000', 'a-strong-password'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_RESET_CODE_INVALID });
    expect(codes.consume).toHaveBeenCalledWith('c1');
  });
});
