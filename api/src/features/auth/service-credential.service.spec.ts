import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ServiceCredentialService } from './service-credential.service';

describe('ServiceCredentialService', () => {
  let repo: any;
  let tokens: any;
  let revocation: any;
  let service: ServiceCredentialService;

  beforeEach(() => {
    repo = {
      create: jest.fn(async (v: any) => ({ id: 'c1', role: 'agent', ...v })),
      findByKeyHash: jest.fn(),
      revoke: jest.fn(async () => undefined),
      touch: jest.fn(async () => undefined),
      list: jest.fn(async () => []),
    };
    tokens = {
      hashToken: jest.fn((t: string) => `hash(${t})`),
      signAccessToken: jest.fn(() => 'agent.jwt'),
      agentTtl: jest.fn(() => 300),
    };
    revocation = { revokeCredential: jest.fn(async () => undefined) };
    service = new ServiceCredentialService(
      repo,
      tokens,
      revocation,
      new ExceptionService(),
    );
  });

  it('issues a credential and returns the plaintext key exactly once', async () => {
    const res = await service.issue('mastra-pipeline', 'admin-1');
    expect(res.apiKey).toMatch(/^svc_[0-9a-f]{8}_/);
    expect(res.keyPrefix).toMatch(/^svc_[0-9a-f]{8}$/);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'mastra-pipeline',
        createdBy: 'admin-1',
        keyHash: `hash(${res.apiKey})`,
      }),
    );
  });

  it('exchanges a valid key for an agent access token', async () => {
    repo.findByKeyHash.mockResolvedValueOnce({
      id: 'c1',
      role: 'agent',
      revokedAt: null,
      expiresAt: null,
    });
    const res = await service.exchangeForToken('svc_abc_secret');
    expect(res).toEqual({ accessToken: 'agent.jwt', expiresIn: 300 });
    expect(tokens.signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'c1', role: 'agent', kind: 'service' }),
      300,
    );
    expect(repo.touch).toHaveBeenCalledWith('c1');
  });

  it('rejects an unknown key', async () => {
    repo.findByKeyHash.mockResolvedValueOnce(null);
    await expect(service.exchangeForToken('nope')).rejects.toMatchObject({
      code: ErrorCode.AUTH_SERVICE_CREDENTIAL_INVALID,
    });
  });

  it('rejects a revoked key', async () => {
    repo.findByKeyHash.mockResolvedValueOnce({
      id: 'c1',
      role: 'agent',
      revokedAt: new Date(),
      expiresAt: null,
    });
    await expect(
      service.exchangeForToken('svc_abc_secret'),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTH_SERVICE_CREDENTIAL_INVALID,
    });
  });
});
