import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import type { CollectionVisibility } from '../../infrastructure/database/schema/search.schema';
import { resolveReadScope, type ReadScopeInput } from './read-scope';

const user: Principal = { kind: 'user', userId: 'u-1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a-1', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'svc-1',
  role: 'agent',
};

const collection = (
  visibility: CollectionVisibility,
  ownerField: string | null = null,
): ReadScopeInput => ({ name: 'c', visibility, ownerField });

describe('resolveReadScope', () => {
  describe('private', () => {
    const def = collection('private');

    it('allows an admin, unfiltered', () => {
      expect(resolveReadScope(def, admin)).toEqual({
        allowed: true,
        ownerFilter: null,
      });
    });

    it('allows the system principal, unfiltered', () => {
      expect(resolveReadScope(def, SYSTEM_PRINCIPAL)).toEqual({
        allowed: true,
        ownerFilter: null,
      });
    });

    // This is the `inbound_email` case: the /mailbox REST API is admin-only,
    // and before this the generic search endpoint served the same bodies to
    // every authenticated user.
    it.each([
      ['user', user],
      ['service', service],
      ['anonymous', GUEST_PRINCIPAL],
    ])('denies a %s principal', (_label, principal) => {
      expect(resolveReadScope(def, principal as Principal)).toEqual({
        allowed: false,
      });
    });
  });

  describe('owner_scoped', () => {
    const def = collection('owner_scoped', 'ownerUserId');

    it('scopes an ordinary user to their own records', () => {
      expect(resolveReadScope(def, user)).toEqual({
        allowed: true,
        ownerFilter: { field: 'ownerUserId', userId: 'u-1' },
      });
    });

    it('lets an admin see everything, unfiltered', () => {
      expect(resolveReadScope(def, admin)).toEqual({
        allowed: true,
        ownerFilter: null,
      });
    });

    it.each([
      ['service', service],
      ['anonymous', GUEST_PRINCIPAL],
    ])('denies a %s principal, which has no owning user', (_l, principal) => {
      expect(resolveReadScope(def, principal as Principal)).toEqual({
        allowed: false,
      });
    });

    // Defence in depth: `validateVisibility` rejects this at write time, so it
    // can only arise from hand-edited data. Denying beats emitting a filter
    // against an undefined attribute.
    it('denies when the collection is misconfigured with no ownerField', () => {
      expect(resolveReadScope(collection('owner_scoped'), user)).toEqual({
        allowed: false,
      });
    });
  });

  describe('shared', () => {
    const def = collection('shared');

    it.each([
      ['user', user],
      ['admin', admin],
      ['service', service],
      ['system', SYSTEM_PRINCIPAL],
    ])('allows a %s principal, unfiltered', (_label, principal) => {
      expect(resolveReadScope(def, principal as Principal)).toEqual({
        allowed: true,
        ownerFilter: null,
      });
    });

    it('still denies an anonymous caller', () => {
      expect(resolveReadScope(def, GUEST_PRINCIPAL)).toEqual({
        allowed: false,
      });
    });
  });

  it('denies an unrecognised visibility rather than defaulting open', () => {
    const def = collection('nonsense' as CollectionVisibility);
    expect(resolveReadScope(def, admin)).toEqual({
      allowed: true,
      ownerFilter: null,
    });
    expect(resolveReadScope(def, user)).toEqual({ allowed: false });
  });
});
