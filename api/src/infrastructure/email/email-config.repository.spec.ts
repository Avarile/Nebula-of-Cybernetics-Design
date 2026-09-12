import { EmailConfigRepository } from './email-config.repository';

function makeDb(row: any) {
  // Chainable select().from().where().limit() -> [row?]. `state` records the
  // `where(...)` argument so tests can assert a filter was actually applied
  // (a regression that drops the isActive/isDeleted filter would otherwise
  // go undetected).
  const state: { whereArg?: unknown } = {};
  const chain: any = {
    from: jest.fn(() => chain),
    where: jest.fn((arg: unknown) => {
      state.whereArg = arg;
      return chain;
    }),
    limit: jest.fn(async () => (row ? [row] : [])),
  };
  const db = { select: jest.fn(() => chain) } as any;
  return { db, state };
}

const crypto = {
  decrypt: jest.fn(() => 'decrypted-pass'),
  encrypt: jest.fn(),
} as any;

describe('EmailConfigRepository', () => {
  beforeEach(() => crypto.decrypt.mockClear());

  it('activeSmtp resolves + decrypts the active row', async () => {
    const { db, state } = makeDb({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      username: 'mailer',
      secretEnc: 'v1.enc',
      fromAddress: 'no-reply@example.com',
      fromName: 'Cyber',
    });
    const repo = new EmailConfigRepository(db, crypto);
    const conn = await repo.activeSmtp();
    expect(state.whereArg).toBeDefined();
    expect(crypto.decrypt).toHaveBeenCalledWith('v1.enc');
    expect(conn).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      username: 'mailer',
      password: 'decrypted-pass',
      fromAddress: 'no-reply@example.com',
      fromName: 'Cyber',
    });
  });

  it('activeSmtp returns null when there is no active row', async () => {
    const { db } = makeDb(null);
    const repo = new EmailConfigRepository(db, crypto);
    expect(await repo.activeSmtp()).toBeNull();
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it('activeImap resolves + decrypts the active row', async () => {
    const { db, state } = makeDb({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user',
      secretEnc: 'v1.imap-enc',
    });
    const repo = new EmailConfigRepository(db, crypto);
    const conn = await repo.activeImap();
    expect(state.whereArg).toBeDefined();
    expect(crypto.decrypt).toHaveBeenCalledWith('v1.imap-enc');
    expect(conn).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user',
      password: 'decrypted-pass',
    });
  });

  it('activeImap returns null password when the row has no secret', async () => {
    const { db } = makeDb({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user',
      secretEnc: null,
    });
    const repo = new EmailConfigRepository(db, crypto);
    const conn = await repo.activeImap();
    expect(conn).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      username: 'user',
      password: null,
    });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
});
