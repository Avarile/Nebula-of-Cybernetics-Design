import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  it('delegates to AuthService.validateUser', async () => {
    const auth = { validateUser: jest.fn(async () => ({ id: 'u1' })) } as any;
    const strategy = new LocalStrategy(auth);
    await strategy.validate('a@b.co', 'pw');
    expect(auth.validateUser).toHaveBeenCalledWith('a@b.co', 'pw');
  });
});

describe('JwtStrategy', () => {
  const config = {
    getOrThrow: () => ({ jwtAccessSecret: 'secret', issuer: 'cybernetics' }),
  } as unknown as ConfigService;

  const validity = (assertLive = jest.fn(async () => undefined)) =>
    ({ assertLive }) as never;

  it('maps a verified payload to a Principal', async () => {
    const strategy = new JwtStrategy(config, validity());
    await expect(
      strategy.validate({
        sub: 'u1',
        role: 'admin',
        kind: 'user',
        sid: 'sess-1',
      }),
    ).resolves.toEqual({ kind: 'user', userId: 'u1', role: 'admin' });
  });

  it('consults the revocation check before returning a principal', async () => {
    const assertLive = jest.fn(async () => undefined);
    const strategy = new JwtStrategy(config, validity(assertLive));
    const claims = {
      sub: 'u1',
      role: 'user' as const,
      kind: 'user' as const,
      sid: 'sess-1',
    };
    await strategy.validate(claims);
    expect(assertLive).toHaveBeenCalledWith(claims);
  });

  // A valid signature proves the token was issued by us, not that the identity
  // behind it still exists. If the check says no, no principal comes back.
  it('rejects a structurally valid token whose session has been revoked', async () => {
    const assertLive = jest.fn(async () => {
      throw new Error('revoked');
    });
    const strategy = new JwtStrategy(config, validity(assertLive));
    await expect(
      strategy.validate({
        sub: 'u1',
        role: 'admin',
        kind: 'user',
        sid: 'sess-1',
      }),
    ).rejects.toThrow('revoked');
  });
});
