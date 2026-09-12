import { Reflector } from '@nestjs/core';
import { ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from './require-permission.decorator';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };

function contextFor(principal?: Principal) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as never;
}

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let resolver: any;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = new Reflector();
    resolver = {
      effectivePermissions: jest.fn(async () => new Set(['project.read'])),
    };
    guard = new PermissionsGuard(reflector, resolver, new ExceptionService());
  });

  const require = (...keys: string[]) =>
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === PERMISSIONS_KEY ? keys : undefined,
      );

  it('passes a route that declares no permission, without a lookup', async () => {
    // Adoption is per-route: this layer must be invisible until opted into.
    require();
    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
    expect(resolver.effectivePermissions).not.toHaveBeenCalled();
  });

  it('allows a caller holding the required permission', async () => {
    require('project.read');
    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('requires ALL declared permissions, not any', async () => {
    require('project.read', 'finance.read');
    await expect(guard.canActivate(contextFor(user))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('names the missing permission in the error', async () => {
    // An opaque 403 on a permission-gated route is the most expensive thing to
    // debug in an RBAC system.
    require('finance.read');
    await expect(guard.canActivate(contextFor(user))).rejects.toThrow(
      /finance\.read/,
    );
  });

  it('treats a request with no principal as a guest', async () => {
    require('project.read');
    resolver.effectivePermissions.mockResolvedValueOnce(new Set());
    await expect(
      guard.canActivate(contextFor(undefined)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
