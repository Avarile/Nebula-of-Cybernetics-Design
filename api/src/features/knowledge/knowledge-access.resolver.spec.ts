import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import {
  permits,
  resolveKnowledgeAccess,
  type KnowledgeGrant,
} from './knowledge-access.resolver';

const owner: Principal = { kind: 'user', userId: 'owner', role: 'user' };
const other: Principal = { kind: 'user', userId: 'other', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'admin', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'c1',
  role: 'agent',
};

const priv = { ownerUserId: 'owner', visibility: 'private' as const };
const restricted = { ownerUserId: 'owner', visibility: 'restricted' as const };
const internal = { ownerUserId: 'owner', visibility: 'internal' as const };

const grant = (over: Partial<KnowledgeGrant> = {}): KnowledgeGrant => ({
  granteeType: 'user',
  granteeUserId: 'other',
  granteeRoleId: null,
  permission: 'read',
  expiresAt: null,
  ...over,
});

describe('resolveKnowledgeAccess', () => {
  it.each`
    label                             | record        | principal           | grants                                                            | expected
    ${'owner of a private record'}    | ${priv}       | ${owner}            | ${[]}                                                             | ${'manage'}
    ${'stranger, private, no grant'}  | ${priv}       | ${other}            | ${[]}                                                             | ${'none'}
    ${'stranger, internal'}           | ${internal}   | ${other}            | ${[]}                                                             | ${'read'}
    ${'stranger, restricted'}         | ${restricted} | ${other}            | ${[]}                                                             | ${'none'}
    ${'admin, private'}               | ${priv}       | ${admin}            | ${[]}                                                             | ${'manage'}
    ${'system, private'}              | ${priv}       | ${SYSTEM_PRINCIPAL} | ${[]}                                                             | ${'manage'}
    ${'anonymous, internal'}          | ${internal}   | ${GUEST_PRINCIPAL}  | ${[]}                                                             | ${'none'}
    ${'user grant'}                   | ${priv}       | ${other}            | ${[grant()]}                                                      | ${'read'}
    ${'user grant, write'}            | ${priv}       | ${other}            | ${[grant({ permission: 'write' })]}                               | ${'write'}
    ${'grant to someone else'}        | ${priv}       | ${other}            | ${[grant({ granteeUserId: 'third' })]}                            | ${'none'}
    ${'authenticated grant'}          | ${priv}       | ${other}            | ${[grant({ granteeType: 'authenticated', granteeUserId: null })]} | ${'comment'}
    ${'service, authenticated grant'} | ${priv}       | ${service}          | ${[grant({ granteeType: 'authenticated', granteeUserId: null })]} | ${'comment'}
    ${'service, private, no grant'}   | ${priv}       | ${service}          | ${[]}                                                             | ${'none'}
  `('$label -> $expected', ({ record, principal, grants, expected }) => {
    const normalized = (grants as KnowledgeGrant[]).map((g) =>
      g.granteeType === 'authenticated'
        ? { ...g, permission: 'comment' as const }
        : g,
    );
    expect(resolveKnowledgeAccess(record, principal, normalized)).toBe(
      expected,
    );
  });

  it('takes the most capable matching grant', () => {
    const access = resolveKnowledgeAccess(priv, other, [
      grant({ permission: 'read' }),
      grant({ permission: 'manage' }),
      grant({ permission: 'comment' }),
    ]);
    expect(access).toBe('manage');
  });

  it('ignores an expired grant at read time, not only after a sweep', () => {
    const expired = grant({
      permission: 'write',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(resolveKnowledgeAccess(priv, other, [expired])).toBe('none');
  });

  it('honours a role grant only for a holder of that role', () => {
    const roleGrant = grant({
      granteeType: 'role',
      granteeUserId: null,
      granteeRoleId: 'role-1',
      permission: 'write',
    });
    expect(resolveKnowledgeAccess(priv, other, [roleGrant], ['role-1'])).toBe(
      'write',
    );
    expect(resolveKnowledgeAccess(priv, other, [roleGrant], ['role-2'])).toBe(
      'none',
    );
  });

  it('raises internal read to the grant level when both apply', () => {
    expect(
      resolveKnowledgeAccess(internal, other, [grant({ permission: 'write' })]),
    ).toBe('write');
  });

  it('never lets an ownerless record fall to a nullish user id', () => {
    expect(
      resolveKnowledgeAccess(
        { ownerUserId: null, visibility: 'private' },
        other,
        [],
      ),
    ).toBe('none');
  });

  describe('permits', () => {
    it('compares capability levels', () => {
      expect(permits('manage', 'read')).toBe(true);
      expect(permits('read', 'write')).toBe(false);
      expect(permits('none', 'read')).toBe(false);
      expect(permits('write', 'write')).toBe(true);
    });
  });
});
