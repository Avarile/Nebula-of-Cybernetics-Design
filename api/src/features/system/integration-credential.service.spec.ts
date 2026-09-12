import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { IntegrationCredentialService } from './integration-credential.service';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'c1',
    provider: 'openai',
    name: 'prod',
    kind: 'api_key',
    secretEnc: 'v1.iv.tag.ct',
    meta: { baseUrl: 'https://api.openai.com' },
    expiresAt: null,
    isActive: true,
    lastUsedAt: null,
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

describe('IntegrationCredentialService', () => {
  let repo: any;
  let crypto: any;
  let audit: any;
  let service: IntegrationCredentialService;

  beforeEach(() => {
    repo = {
      create: jest.fn(async (v: any) => makeRow(v)),
      findActiveById: jest.fn(async () => makeRow()),
      findByProviderAndName: jest.fn(async () => null),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      update: jest.fn(async (id: string, patch: any) =>
        makeRow({ id, ...patch }),
      ),
      softDelete: jest.fn(async () => undefined),
    };
    crypto = {
      encrypt: jest.fn(() => 'v1.enc'),
      decrypt: jest.fn(() => 'sk-secret'),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new IntegrationCredentialService(
      repo,
      crypto,
      audit,
      new ExceptionService(),
    );
  });

  it('encrypts the secret on create and redacts it', async () => {
    const res = await service.create(
      {
        provider: 'openai',
        name: 'prod',
        kind: 'api_key',
        secret: 'sk-raw',
        meta: {},
      } as any,
      ctx,
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('sk-raw');
    expect((res as any).secretEnc).toBeUndefined();
    expect(res.hasSecret).toBe(true);
    expect(res.provider).toBe('openai');
  });

  it('rejects a duplicate (provider, name)', async () => {
    repo.findByProviderAndName.mockResolvedValueOnce(makeRow());
    await expect(
      service.create(
        {
          provider: 'openai',
          name: 'prod',
          kind: 'api_key',
          secret: 'x',
        } as any,
        ctx,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'A credential named "prod" already exists for openai',
    });
  });

  it('rejects renaming to a (provider, name) owned by a different credential', async () => {
    repo.findByProviderAndName.mockResolvedValueOnce(
      makeRow({ id: 'other-id' }),
    );
    await expect(
      service.update('c1', { name: 'taken' } as any, ctx),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'A credential named "taken" already exists for openai',
    });
  });

  it('allows update when the (provider, name) match is the same row (no-op rename)', async () => {
    repo.findByProviderAndName.mockResolvedValueOnce(makeRow({ id: 'c1' }));
    const res = await service.update('c1', { name: 'prod' } as any, ctx);
    expect(res.id).toBe('c1');
  });

  it('allows update when there is no (provider, name) collision', async () => {
    repo.findByProviderAndName.mockResolvedValueOnce(null);
    const res = await service.update('c1', { name: 'new-name' } as any, ctx);
    expect(res.id).toBe('c1');
  });

  it('short-circuits an empty patch without writing or auditing', async () => {
    const res = await service.update('c1', {} as any, ctx);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(res).toEqual({
      id: 'c1',
      provider: 'openai',
      name: 'prod',
      kind: 'api_key',
      meta: { baseUrl: 'https://api.openai.com' },
      expiresAt: null,
      isActive: true,
      hasSecret: true,
      lastUsedAt: null,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-01'),
    });
  });

  it('404s on a missing credential', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toMatchObject({
      code: ErrorCode.CONFIG_NOT_FOUND,
      message: 'Integration credential not found',
    });
  });

  it('decrypts the secret for internal consumers only', async () => {
    const secret = await service.getDecryptedSecret('c1');
    expect(crypto.decrypt).toHaveBeenCalledWith('v1.iv.tag.ct');
    expect(secret).toBe('sk-secret');
  });
});
