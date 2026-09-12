import type { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function ctx(user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('RolesGuard', () => {
  function guardWith(required: string[] | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn(() => required),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows when no roles are required', () => {
    expect(
      guardWith(undefined).canActivate(
        ctx({ kind: 'user', userId: 'u', role: 'user' }),
      ),
    ).toBe(true);
  });
  it('allows when the role matches', () => {
    expect(
      guardWith(['admin']).canActivate(
        ctx({ kind: 'user', userId: 'a', role: 'admin' }),
      ),
    ).toBe(true);
  });
  it('denies when the role does not match', () => {
    expect(
      guardWith(['admin']).canActivate(
        ctx({ kind: 'user', userId: 'u', role: 'user' }),
      ),
    ).toBe(false);
  });
  it('treats an absent user as guest', () => {
    expect(guardWith(['admin']).canActivate(ctx(undefined))).toBe(false);
  });
});
