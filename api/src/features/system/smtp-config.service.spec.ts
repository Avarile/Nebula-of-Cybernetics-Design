import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SmtpConfigService } from './smtp-config.service';

jest.mock('../../infrastructure/email/transport/smtp.transport', () => ({
  verifySmtp: jest.fn(async () => undefined),
}));
import { verifySmtp } from '../../infrastructure/email/transport/smtp.transport';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 's1',
    name: 'Primary',
    host: 'smtp.example.com',
    port: 587,
    username: 'mailer',
    secretEnc: 'v1.iv.tag.ct',
    secure: true,
    fromAddress: 'no-reply@example.com',
    fromName: null,
    isActive: false,
    lastTestedAt: null,
    lastTestStatus: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

const ctx = { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' };

describe('SmtpConfigService', () => {
  let repo: any;
  let crypto: any;
  let audit: any;
  let service: SmtpConfigService;

  beforeEach(() => {
    (verifySmtp as jest.Mock).mockClear();
    repo = {
      create: jest.fn(async (v: any) => makeRow(v)),
      findActiveById: jest.fn(async () => makeRow()),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      update: jest.fn(async (id: string, patch: any) =>
        makeRow({ id, ...patch }),
      ),
      softDelete: jest.fn(async () => undefined),
      activate: jest.fn(async (id: string) => makeRow({ id, isActive: true })),
      stampTest: jest.fn(async () => undefined),
    };
    crypto = {
      encrypt: jest.fn(() => 'v1.enc'),
      decrypt: jest.fn(() => 'plaintext-pass'),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new SmtpConfigService(
      repo,
      crypto,
      audit,
      new ExceptionService(),
    );
  });

  it('encrypts the secret on create and never returns it', async () => {
    const res = await service.create(
      {
        name: 'Primary',
        host: 'smtp.example.com',
        port: 587,
        username: 'mailer',
        secret: 'raw-pass',
        secure: true,
        fromAddress: 'no-reply@example.com',
      } as any,
      ctx,
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('raw-pass');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ secretEnc: 'v1.enc' }),
    );
    expect((res as any).secretEnc).toBeUndefined();
    expect((res as any).secret).toBeUndefined();
    expect(res.hasSecret).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'smtp.create', entityType: 'smtp' }),
    );
  });

  it('re-encrypts only when a new secret is supplied on update', async () => {
    await service.update('s1', { host: 'new.example.com' } as any, ctx);
    expect(crypto.encrypt).not.toHaveBeenCalled();
    await service.update('s1', { secret: 'new-pass' } as any, ctx);
    expect(crypto.encrypt).toHaveBeenCalledWith('new-pass');
  });

  it('short-circuits an empty patch without writing or auditing', async () => {
    const res = await service.update('s1', {} as any, ctx);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(res).toEqual({
      id: 's1',
      name: 'Primary',
      host: 'smtp.example.com',
      port: 587,
      username: 'mailer',
      secure: true,
      fromAddress: 'no-reply@example.com',
      fromName: null,
      isActive: false,
      hasSecret: true,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-01'),
    });
  });

  it('404s on a missing config', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toMatchObject({
      code: ErrorCode.CONFIG_NOT_FOUND,
      message: 'SMTP config not found',
    });
  });

  it('activates via the repo transaction and audits', async () => {
    const res = await service.activate('s1', ctx);
    expect(repo.activate).toHaveBeenCalledWith('s1');
    expect(res.isActive).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'smtp.activate' }),
    );
  });

  it('tests the connection, stamps status, and reports ok', async () => {
    const res = await service.test('s1', ctx);
    expect(verifySmtp).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        password: 'plaintext-pass',
        fromAddress: 'no-reply@example.com',
        fromName: null,
      }),
    );
    expect(repo.stampTest).toHaveBeenCalledWith('s1', 'ok');
    expect(res).toEqual({ ok: true });
  });

  it('reports a failed connection test without throwing', async () => {
    (verifySmtp as jest.Mock).mockRejectedValueOnce(new Error('EAUTH'));
    const res = await service.test('s1', ctx);
    expect(repo.stampTest).toHaveBeenCalledWith('s1', 'failed');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('EAUTH');
  });
});
