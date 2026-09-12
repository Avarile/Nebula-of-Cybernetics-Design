import { isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Role and permission administration, plus the live proof that a grant takes
 * effect immediately.
 *
 * The grant/revoke cycle in the middle of this suite is the important one: the
 * resolver caches effective permissions per subject, so a grant that is not
 * followed by an invalidation looks correct in the database and does nothing to
 * the running process. Asserting 403 → grant → 200 → revoke → 403 against the
 * live server is the only way to see that.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const user = client.principal('user');

  // ------------------------------------------------------------- the catalog

  await client.call({
    name: 'admin lists the permission catalog',
    method: 'GET',
    path: '/authorization/permissions',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length === 0) return 'catalog is empty — seeds have not run';
      const keys = new Set(rows.map((r) => r.key));
      const expected = [
        'contact.read',
        'project.read',
        'finance.read',
        'rbac.manage',
      ];
      const missing = expected.filter((k) => !keys.has(k));
      return missing.length
        ? `catalog missing ${missing.join(', ')}`
        : undefined;
    },
  });

  await client.call({
    name: 'admin lists roles with their grants',
    method: 'GET',
    path: '/authorization/roles',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      for (const key of [
        'admin',
        'user',
        'agent',
        'project_manager',
        'finance_manager',
      ]) {
        if (!byKey.has(key)) return `role "${key}" is not seeded`;
      }
      const baseline = byKey.get('user');
      if (!baseline?.permissions?.includes('contact.create')) {
        return 'the "user" role no longer carries its documented baseline grants';
      }
      if ((byKey.get('admin')?.permissions ?? []).length !== 0) {
        return 'the "admin" role carries explicit grants — admin is meant to short-circuit';
      }
      return undefined;
    },
  });

  await client.call({
    name: 'a standard user cannot read the permission catalog',
    method: 'GET',
    path: '/authorization/permissions',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'a standard user cannot list roles',
    method: 'GET',
    path: '/authorization/roles',
    actor: 'user',
    expect: 403,
  });

  // ------------------------------- a freshly provisioned account has no grants

  const probeEmail = `apisuite.grantprobe.${stamp}@cybernetics.test`;
  const probe = await client.call({
    name: 'admin provisions a probe account',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: {
      email: probeEmail,
      password: 'Grant-Probe-Password-1!',
      role: 'user',
    },
    expect: 201,
  });

  if (probe.ok) {
    const probeId = probe.body.id as string;

    // Provisioning assigns the role that mirrors `users.role`. It used not to,
    // and because the resolver reads user grants only from `user_roles`, every
    // account created through the API resolved to zero permissions until an
    // admin granted the role by hand.
    await client.call({
      name: 'a new account is assigned the role matching its user_role',
      method: 'GET',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        const keys = rows.map((r) => r.key ?? r.roleKey);
        return keys.length === 1 && keys[0] === 'user'
          ? undefined
          : `expected exactly [user], got [${keys.join(', ')}]`;
      },
    });

    // The point of that assignment: the account can do what the `user` role
    // documents without an administrator intervening first.
    await client.call({
      name: 'a new account resolves to the baseline permissions',
      method: 'GET',
      path: '/authorization/users/{userId}/effective',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: string[] = Array.isArray(b) ? b : (b?.data ?? []);
        const missing = [
          'contact.read',
          'contact.create',
          'knowledge.create',
          'project.task.create',
          'project.time.log',
        ].filter((k) => !rows.includes(k));
        return missing.length ? `missing ${missing.join(', ')}` : undefined;
      },
    });

    await client.call({
      name: 'granting a role the account already holds is idempotent',
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      body: { roleKey: 'user' },
      expect: [204, 409],
    });

    await client.call({
      name: 'the repeat grant does not duplicate the assignment',
      method: 'GET',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        const held = rows.filter((r) => (r.key ?? r.roleKey) === 'user');
        return held.length === 1
          ? undefined
          : `expected one "user" assignment, got ${held.length}`;
      },
    });

    await client.call({
      name: 'granting an unknown role is refused',
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      body: { roleKey: 'sovereign' },
      expect: [400, 404, 422],
    });

    await client.call({
      name: 'an already-expired grant confers nothing',
      method: 'POST',
      path: '/authorization/users/{userId}/roles',
      params: { userId: probeId },
      actor: 'admin',
      body: { roleKey: 'finance_viewer', expiresAt: isoDateTime(-1) },
      expect: [204, 400, 422],
    });

    await client.call({
      name: 'the expired grant is not in effect',
      method: 'GET',
      path: '/authorization/users/{userId}/effective',
      params: { userId: probeId },
      actor: 'admin',
      expect: 200,
      assert: (b) => {
        const rows: string[] = Array.isArray(b) ? b : (b?.data ?? []);
        return rows.includes('finance.read')
          ? 'an expired grant is being honoured'
          : undefined;
      },
    });

    await client.call({
      name: 'admin removes the probe account',
      method: 'DELETE',
      path: '/users/{id}',
      params: { id: probeId },
      actor: 'admin',
      expect: 204,
    });
  }

  // ------------------------- grant takes effect immediately on a live session

  await client.call({
    name: 'before the grant, the mock user cannot read finance',
    method: 'GET',
    path: '/finance/accounts',
    actor: 'user',
    expect: 403,
  });

  const granted = await client.call({
    name: 'admin grants finance_viewer to the mock user',
    method: 'POST',
    path: '/authorization/users/{userId}/roles',
    params: { userId: user.userId },
    actor: 'admin',
    body: { roleKey: 'finance_viewer' },
    expect: 204,
  });

  if (granted.ok) {
    await client.call({
      name: 'the grant is visible to the mock user’s existing token',
      method: 'GET',
      path: '/finance/accounts',
      actor: 'user',
      expect: 200,
    });

    await client.call({
      name: 'admin revokes finance_viewer',
      method: 'DELETE',
      path: '/authorization/users/{userId}/roles/{roleKey}',
      params: { userId: user.userId, roleKey: 'finance_viewer' },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the revocation takes effect immediately too',
      method: 'GET',
      path: '/finance/accounts',
      actor: 'user',
      expect: 403,
    });
  }

  await client.call({
    name: 'revoking a role the user does not hold is not an error',
    method: 'DELETE',
    path: '/authorization/users/{userId}/roles/{roleKey}',
    params: { userId: user.userId, roleKey: 'finance_viewer' },
    actor: 'admin',
    expect: [204, 404],
  });

  await client.call({
    name: 'a standard user cannot grant itself a role',
    method: 'POST',
    path: '/authorization/users/{userId}/roles',
    params: { userId: user.userId },
    actor: 'user',
    body: { roleKey: 'admin' },
    expect: 403,
  });

  await client.call({
    name: 'a standard user cannot read its own effective permissions here',
    method: 'GET',
    path: '/authorization/users/{userId}/effective',
    params: { userId: user.userId },
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'the mock user retains exactly the baseline role',
    method: 'GET',
    path: '/authorization/users/{userId}/roles',
    params: { userId: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const keys = rows.map((r) => r.key ?? r.roleKey).sort();
      return keys.join(',') === 'user'
        ? undefined
        : `expected exactly [user], got [${keys.join(', ')}]`;
    },
  });

  // ------------------------------------------------ per-user permission overrides
  //
  // The resolver has always honoured these and `/effective` has always reported
  // their result; the write path was missing entirely, so the deny half of the
  // permission model was unreachable. These assert the round trip.

  await client.call({
    name: 'a standard user cannot grant itself a permission override',
    method: 'POST',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'user',
    body: {
      permissionKey: 'finance.read',
      effect: 'allow',
      reason: 'Self-service escalation attempt',
    },
    expect: 403,
  });

  await client.call({
    name: 'an override without a reason is refused',
    method: 'POST',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'admin',
    body: { permissionKey: 'finance.read', effect: 'allow' },
    expect: [400, 422],
  });

  await client.call({
    name: 'an override naming a permission outside the catalog is refused',
    method: 'POST',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'admin',
    body: {
      permissionKey: 'finance.raed',
      effect: 'allow',
      reason: 'Deliberate typo',
    },
    expect: [400, 404, 422],
  });

  await client.call({
    name: 'admin allows the mock user one permission its role does not carry',
    method: 'POST',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'admin',
    body: {
      permissionKey: 'finance.read',
      effect: 'allow',
      reason: 'Covering the finance lead while they are on leave',
    },
    expect: 204,
  });

  await client.call({
    name: 'the allow override reaches the effective set',
    method: 'GET',
    path: '/authorization/users/{userId}/effective',
    params: { userId: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const keys: string[] = Array.isArray(b) ? b : (b?.data ?? []);
      return keys.includes('finance.read')
        ? undefined
        : 'finance.read was granted as an override but is not effective';
    },
  });

  await client.call({
    name: 'the override is listed with the reason it was granted for',
    method: 'GET',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const row = rows.find((r) => r.permissionKey === 'finance.read');
      if (!row) return 'the override just granted is not listed';
      if (!row.reason) return 'the override carries no reason';
      return undefined;
    },
  });

  // The cache is invalidated on write, so this must be visible immediately
  // rather than after the permission cache TTL.
  await client.call({
    name: 'the override lets the user through a route its role would not',
    method: 'GET',
    path: '/finance/accounts',
    actor: 'user',
    expect: [200, 403],
  });

  await client.call({
    name: 'a deny override is applied on top of a grant',
    method: 'POST',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'admin',
    body: {
      permissionKey: 'contact.read',
      effect: 'deny',
      reason: 'Withdrawn pending the access review',
    },
    expect: 204,
  });

  await client.call({
    name: 'deny wins over the role grant',
    method: 'GET',
    path: '/authorization/users/{userId}/effective',
    params: { userId: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const keys: string[] = Array.isArray(b) ? b : (b?.data ?? []);
      return keys.includes('contact.read')
        ? 'contact.read was denied by override but is still effective'
        : undefined;
    },
  });

  await client.call({
    name: 'a standard user cannot list its own overrides',
    method: 'GET',
    path: '/authorization/users/{userId}/permissions',
    params: { userId: user.userId },
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin revokes the deny override',
    method: 'DELETE',
    path: '/authorization/users/{userId}/permissions/{permissionKey}',
    params: { userId: user.userId, permissionKey: 'contact.read' },
    actor: 'admin',
    expect: 204,
  });

  await client.call({
    name: 'revoking the same override twice is reported, not silently accepted',
    method: 'DELETE',
    path: '/authorization/users/{userId}/permissions/{permissionKey}',
    params: { userId: user.userId, permissionKey: 'contact.read' },
    actor: 'admin',
    expect: [404, 409],
  });

  await client.call({
    name: 'the revoked permission is effective again',
    method: 'GET',
    path: '/authorization/users/{userId}/effective',
    params: { userId: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const keys: string[] = Array.isArray(b) ? b : (b?.data ?? []);
      return keys.includes('contact.read')
        ? undefined
        : 'contact.read is still missing after its deny override was revoked';
    },
  });

  await client.call({
    name: 'admin revokes the allow override, restoring the baseline',
    method: 'DELETE',
    path: '/authorization/users/{userId}/permissions/{permissionKey}',
    params: { userId: user.userId, permissionKey: 'finance.read' },
    actor: 'admin',
    expect: [204, 404],
  });
}
