import { AppException, ErrorCode } from '../infrastructure/exceptions';
import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  isAdmin,
  isUser,
  requireUserId,
  roleOf,
  userIdOrNull,
  type Principal,
} from './principal';

const user: Principal = { kind: 'user', userId: 'u-1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a-1', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'svc-1',
  role: 'agent',
};

describe('principals', () => {
  it('system principal carries no id at all', () => {
    expect(SYSTEM_PRINCIPAL).toEqual({ kind: 'system' });
  });

  it('guest principal is anonymous and distinguishable from system', () => {
    expect(GUEST_PRINCIPAL).toEqual({ kind: 'anonymous' });
    // The whole point of the union: these two used to be `{ id: null }` twins,
    // so an ownership check comparing ids granted a guest whatever the system owned.
    expect(GUEST_PRINCIPAL).not.toEqual(SYSTEM_PRINCIPAL);
  });
});

describe('isUser', () => {
  it.each([
    ['user', user, true],
    ['admin', admin, true],
    ['service', service, false],
    ['system', SYSTEM_PRINCIPAL, false],
    ['anonymous', GUEST_PRINCIPAL, false],
  ])('%s -> %s', (_label, principal, expected) => {
    expect(isUser(principal as Principal)).toBe(expected);
  });
});

describe('isAdmin', () => {
  it('is true only for a user principal with the admin role', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(user)).toBe(false);
    expect(isAdmin(service)).toBe(false);
    expect(isAdmin(SYSTEM_PRINCIPAL)).toBe(false);
    expect(isAdmin(GUEST_PRINCIPAL)).toBe(false);
  });

  it('does not treat the system principal as an admin', () => {
    // System is privileged for *internal* reads, but it is not an API admin and
    // must never satisfy an @Roles('admin') check.
    expect(isAdmin(SYSTEM_PRINCIPAL)).toBe(false);
  });
});

describe('roleOf', () => {
  it.each([
    [user, 'user'],
    [admin, 'admin'],
    [service, 'agent'],
    [SYSTEM_PRINCIPAL, 'agent'],
    [GUEST_PRINCIPAL, 'guest'],
  ])('maps %o to %s', (principal, expected) => {
    expect(roleOf(principal as Principal)).toBe(expected);
  });
});

describe('userIdOrNull', () => {
  it('returns the user id only for a user principal', () => {
    expect(userIdOrNull(user)).toBe('u-1');
    expect(userIdOrNull(admin)).toBe('a-1');
  });

  it('returns null for every non-user principal', () => {
    // A service credential id is a `service_credentials.id`; writing it into a
    // column with a `users.id` foreign key is the FK violation this prevents.
    expect(userIdOrNull(service)).toBeNull();
    expect(userIdOrNull(SYSTEM_PRINCIPAL)).toBeNull();
    expect(userIdOrNull(GUEST_PRINCIPAL)).toBeNull();
  });
});

describe('requireUserId', () => {
  it('returns the id for a user principal', () => {
    expect(requireUserId(user)).toBe('u-1');
  });

  it.each([
    ['service', service],
    ['system', SYSTEM_PRINCIPAL],
    ['anonymous', GUEST_PRINCIPAL],
  ])('throws UNAUTHORIZED for a %s principal', (_label, principal) => {
    expect(() => requireUserId(principal as Principal)).toThrow(AppException);
    try {
      requireUserId(principal as Principal);
    } catch (err) {
      expect((err as AppException).code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });
});
