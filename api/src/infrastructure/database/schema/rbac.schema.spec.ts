import {
  permissionEffect,
  permissions,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
} from './rbac.schema';

describe('rbac schema', () => {
  it('defines permission_effect with deny available', () => {
    expect(permissionEffect.enumValues).toEqual(['allow', 'deny']);
  });

  it('exposes the authorization tables', () => {
    expect(permissions).toBeDefined();
    expect(roles).toBeDefined();
    expect(rolePermissions).toBeDefined();
    expect(userRoles).toBeDefined();
    expect(userPermissions).toBeDefined();
  });

  it('requires a reason on every per-user exception', () => {
    // An exception without a recorded reason becomes permanent by amnesia.
    expect(userPermissions.reason.notNull).toBe(true);
  });

  it('supports time-boxed elevation', () => {
    expect(userRoles.expiresAt).toBeDefined();
    expect(userPermissions.expiresAt).toBeDefined();
  });
});
