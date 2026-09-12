import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import {
  canManageContact,
  canReadContact,
  resolveContactAccess,
} from './contact-scope.resolver';

const owner: Principal = { kind: 'user', userId: 'owner', role: 'user' };
const other: Principal = { kind: 'user', userId: 'other', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'admin', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'c1',
  role: 'agent',
};

const privateContact = {
  ownerUserId: 'owner',
  visibility: 'private' as const,
};
const sharedContact = { ownerUserId: 'owner', visibility: 'shared' as const };
const ownerlessContact = { ownerUserId: null, visibility: 'private' as const };

describe('resolveContactAccess', () => {
  // The exhaustive truth table. Every cell here is a decision someone could
  // otherwise re-derive differently at a second call site.
  it.each`
    label                      | contact             | principal           | expected
    ${'owner, private'}        | ${privateContact}   | ${owner}            | ${'manage'}
    ${'owner, shared'}         | ${sharedContact}    | ${owner}            | ${'manage'}
    ${'other user, private'}   | ${privateContact}   | ${other}            | ${'none'}
    ${'other user, shared'}    | ${sharedContact}    | ${other}            | ${'read'}
    ${'admin, private'}        | ${privateContact}   | ${admin}            | ${'manage'}
    ${'system, private'}       | ${privateContact}   | ${SYSTEM_PRINCIPAL} | ${'manage'}
    ${'service, private'}      | ${privateContact}   | ${service}          | ${'none'}
    ${'service, shared'}       | ${sharedContact}    | ${service}          | ${'read'}
    ${'anonymous, shared'}     | ${sharedContact}    | ${GUEST_PRINCIPAL}  | ${'none'}
    ${'ownerless, other user'} | ${ownerlessContact} | ${other}            | ${'none'}
  `('$label -> $expected', ({ contact, principal, expected }) => {
    expect(resolveContactAccess(contact, principal)).toBe(expected);
  });

  it('never lets an ownerless contact fall to whoever asks', () => {
    // `ownerUserId === principal.userId` must not match when both are nullish —
    // the bug the Principal union was introduced to make unrepresentable.
    expect(resolveContactAccess(ownerlessContact, other)).toBe('none');
    expect(resolveContactAccess(ownerlessContact, GUEST_PRINCIPAL)).toBe(
      'none',
    );
  });

  it('maps access levels to capabilities', () => {
    expect(canReadContact('read')).toBe(true);
    expect(canManageContact('read')).toBe(false);
    expect(canManageContact('manage')).toBe(true);
    expect(canReadContact('none')).toBe(false);
  });
});
