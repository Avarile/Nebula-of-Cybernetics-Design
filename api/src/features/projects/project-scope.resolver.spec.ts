import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import { permitsProject, resolveProjectAccess } from './project-scope.resolver';

const owner: Principal = { kind: 'user', userId: 'owner', role: 'user' };
const member: Principal = { kind: 'user', userId: 'member', role: 'user' };
const stranger: Principal = { kind: 'user', userId: 'stranger', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'admin', role: 'admin' };
const service: Principal = {
  kind: 'service',
  credentialId: 'c1',
  role: 'agent',
};

const priv = { ownerUserId: 'owner', visibility: 'private' as const };
const internal = { ownerUserId: 'owner', visibility: 'internal' as const };
const unowned = { ownerUserId: null, visibility: 'private' as const };
const asMember = (roleInProject: string) => ({ roleInProject }) as never;

describe('resolveProjectAccess', () => {
  it.each`
    label                      | project     | principal           | membership                 | expected
    ${'owner'}                 | ${priv}     | ${owner}            | ${null}                    | ${'owner'}
    ${'admin'}                 | ${priv}     | ${admin}            | ${null}                    | ${'owner'}
    ${'system pipeline'}       | ${priv}     | ${SYSTEM_PRINCIPAL} | ${null}                    | ${'owner'}
    ${'stranger, private'}     | ${priv}     | ${stranger}         | ${null}                    | ${'none'}
    ${'stranger, internal'}    | ${internal} | ${stranger}         | ${null}                    | ${'viewer'}
    ${'member as manager'}     | ${priv}     | ${member}           | ${asMember('manager')}     | ${'manager'}
    ${'member as contributor'} | ${priv}     | ${member}           | ${asMember('contributor')} | ${'contributor'}
    ${'member as viewer'}      | ${priv}     | ${member}           | ${asMember('viewer')}      | ${'viewer'}
    ${'anonymous, internal'}   | ${internal} | ${GUEST_PRINCIPAL}  | ${null}                    | ${'none'}
    ${'service, internal'}     | ${internal} | ${service}          | ${null}                    | ${'viewer'}
    ${'service, private'}      | ${priv}     | ${service}          | ${null}                    | ${'none'}
    ${'unowned, stranger'}     | ${unowned}  | ${stranger}         | ${null}                    | ${'none'}
  `('$label -> $expected', ({ project, principal, membership, expected }) => {
    expect(resolveProjectAccess(project, principal, membership)).toBe(expected);
  });

  it('prefers ownership over a lesser membership row', () => {
    // Someone who both owns the project and holds a viewer row must not be
    // demoted by the row.
    expect(resolveProjectAccess(priv, owner, asMember('viewer'))).toBe('owner');
  });

  it('never lets an unowned project fall to a nullish user id', () => {
    expect(resolveProjectAccess(unowned, GUEST_PRINCIPAL, null)).toBe('none');
  });

  describe('permitsProject', () => {
    it('treats owner as the most capable', () => {
      expect(permitsProject('owner', 'viewer')).toBe(true);
      expect(permitsProject('owner', 'manager')).toBe(true);
    });

    it('refuses to promote a lesser role', () => {
      expect(permitsProject('viewer', 'contributor')).toBe(false);
      expect(permitsProject('contributor', 'manager')).toBe(false);
    });

    it('accepts an exact match', () => {
      expect(permitsProject('contributor', 'contributor')).toBe(true);
    });

    it('denies "none" everything', () => {
      expect(permitsProject('none', 'viewer')).toBe(false);
    });
  });
});
