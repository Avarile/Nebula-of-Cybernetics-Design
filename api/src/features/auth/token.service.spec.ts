import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let jwt: any;
  let service: TokenService;

  const config = {
    getOrThrow: () => ({
      jwtAccessSecret: 'test-secret',
      issuer: 'cybernetics',
      accessTtl: 900,
      refreshTtl: 604800,
      agentTokenTtl: 300,
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jwt = { sign: jest.fn(() => 'signed.jwt.token') };
    service = new TokenService(jwt as unknown as JwtService, config);
  });

  it('signs an access token with claims, secret, issuer and ttl', () => {
    const token = service.signAccessToken({
      sub: 'u1',
      role: 'user',
      email: 'a@b.co',
      kind: 'user',
    });
    expect(token).toBe('signed.jwt.token');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', role: 'user', kind: 'user' }),
      expect.objectContaining({
        secret: 'test-secret',
        issuer: 'cybernetics',
        expiresIn: 900,
      }),
    );
  });

  it('honors an explicit ttl override (agent tokens)', () => {
    service.signAccessToken({ sub: 'c1', role: 'agent', kind: 'service' }, 300);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ expiresIn: 300 }),
    );
  });

  it('generates unique refresh tokens with a sha256 hash', () => {
    const a = service.generateRefreshToken();
    const b = service.generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashToken(a.token)).toBe(a.tokenHash);
  });
});
