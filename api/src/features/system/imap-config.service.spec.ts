import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ImapConfigService } from './imap-config.service';

jest.mock('../../infrastructure/email/transport/imap.transport', () => ({
  verifyImap: jest.fn(async () => undefined),
}));
import { verifyImap } from '../../infrastructure/email/transport/imap.transport';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'i1',
    name: 'Inbox',
    host: 'imap.example.com',
    port: 993,
    username: 'reader',
    secretEnc: 'v1.iv.tag.ct',
    secure: true,
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

describe('ImapConfigService', () => {
  let repo: any;
  let crypto: any;
  let audit: any;
  let service: ImapConfigService;

  beforeEach(() => {
    (verifyImap as jest.Mock).mockClear();
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
    crypto = { encrypt: jest.fn(() => 'v1.enc'), decrypt: jest.fn(() => 'pw') };
    audit = { record: jest.fn(async () => undefined) };
    service = new ImapConfigService(
      repo,
      crypto,
      audit,
      new ExceptionService(),
    );
  });

  it('encrypts the secret on create and redacts it', async () => {
    const res = await service.create(
      {
        name: 'Inbox',
        host: 'imap.example.com',
        port: 993,
        username: 'reader',
        secret: 'raw',
        secure: true,
      } as any,
      ctx,
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('raw');
    expect((res as any).secretEnc).toBeUndefined();
    expect(res.hasSecret).toBe(true);
  });

  it('404s on a missing config', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toMatchObject({
      code: ErrorCode.CONFIG_NOT_FOUND,
      message: 'IMAP config not found',
    });
  });

  it('activates via the repo transaction', async () => {
    const res = await service.activate('i1', ctx);
    expect(repo.activate).toHaveBeenCalledWith('i1');
    expect(res.isActive).toBe(true);
  });

  it('short-circuits an empty patch without writing or auditing', async () => {
    const res = await service.update('i1', {} as any, ctx);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(res).toEqual({
      id: 'i1',
      name: 'Inbox',
      host: 'imap.example.com',
      port: 993,
      username: 'reader',
      secure: true,
      isActive: false,
      hasSecret: true,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-01'),
    });
  });

  it('reports a failed connection test without throwing', async () => {
    (verifyImap as jest.Mock).mockRejectedValueOnce(
      new Error('login rejected'),
    );
    const res = await service.test('i1', ctx);
    expect(repo.stampTest).toHaveBeenCalledWith('i1', 'failed');
    expect(res.ok).toBe(false);
  });
});
