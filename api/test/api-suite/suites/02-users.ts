import type { Ctx } from '../harness/context';

/**
 * User administration and self-service profile/preferences.
 *
 * The interesting boundary here is that `/users/*` is admin-only while `/me/*`
 * is self-service: the same person reads their profile through two different
 * doors, and only one of them may read anybody else's.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const user = client.principal('user');

  // ------------------------------------------------------------- admin CRUD

  await client.call({
    name: 'admin lists users with pagination',
    method: 'GET',
    path: '/users',
    actor: 'admin',
    query: { page: 1, limit: 5 },
    expect: 200,
    assert: (b) => {
      if (!Array.isArray(b?.data)) return 'expected a paginated envelope';
      if (b.limit !== 5) return `limit echoed as ${b.limit}`;
      if (b.data.some((u: any) => 'passwordHash' in u))
        return 'listing leaked passwordHash';
      return undefined;
    },
  });

  await client.call({
    name: 'a standard user cannot list users',
    method: 'GET',
    path: '/users',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin reads a single user',
    method: 'GET',
    path: '/users/{id}',
    params: { id: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) =>
      b?.email === user.email ? undefined : `email was ${b?.email}`,
  });

  await client.call({
    name: 'an unknown user id is a 404, not a 500',
    method: 'GET',
    path: '/users/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'admin',
    expect: 404,
  });

  await client.call({
    name: 'a non-uuid user id is rejected before it reaches the database',
    method: 'GET',
    path: '/users/{id}',
    params: { id: 'not-a-uuid' },
    actor: 'admin',
    expect: 400,
  });

  await client.call({
    name: 'admin renames a user',
    method: 'PATCH',
    path: '/users/{id}',
    params: { id: user.userId },
    actor: 'admin',
    body: { displayName: 'Mock Suite User' },
    expect: 200,
    assert: (b) =>
      b?.displayName === 'Mock Suite User'
        ? undefined
        : `displayName was ${b?.displayName}`,
  });

  await client.call({
    name: 'a standard user cannot promote itself to admin',
    method: 'PATCH',
    path: '/users/{id}',
    params: { id: user.userId },
    actor: 'user',
    body: { role: 'admin' },
    expect: 403,
  });

  await client.call({
    name: 'user creation rejects a duplicate address',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: { email: user.email, password: 'Duplicate-Password-1!' },
    expect: [409, 400, 422],
  });

  await client.call({
    name: 'user creation rejects a weak password',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: { email: `weak.${stamp}@cybernetics.test`, password: 'short' },
    expect: 400,
  });

  await client.call({
    name: 'user creation rejects an unknown role',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: {
      email: `badrole.${stamp}@cybernetics.test`,
      password: 'Fine-Password-123!',
      role: 'superuser',
    },
    expect: 400,
  });

  // A second real account, kept for project membership and mention tests.
  const second = await client.call({
    name: 'admin creates a second user for collaboration tests',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: {
      email: `apisuite.collab.${stamp}@cybernetics.test`,
      password: 'Collaborator-Password-1!',
      role: 'user',
      displayName: 'Collaborator',
    },
    expect: 201,
  });
  if (second.ok) ctx.ids.secondUserId = second.body.id;

  await client.call({
    name: 'admin reads another user’s extended profile',
    method: 'GET',
    path: '/users/{id}/profile',
    params: { id: user.userId },
    actor: 'admin',
    expect: [200, 404],
  });

  await client.call({
    name: 'a standard user cannot read another user’s profile',
    method: 'GET',
    path: '/users/{id}/profile',
    params: { id: ctx.ids.secondUserId ?? user.userId },
    actor: 'user',
    expect: 403,
  });

  // ---------------------------------------------------------- self-service me

  await client.call({
    name: 'user reads its own profile',
    method: 'GET',
    path: '/me/profile',
    actor: 'user',
    expect: 200,
  });

  await client.call({
    name: 'user updates its own profile',
    method: 'PATCH',
    path: '/me/profile',
    actor: 'user',
    body: {
      firstName: 'Mock',
      lastName: 'User',
      jobTitle: 'API Suite Subject',
      department: 'Quality',
      timezone: 'Australia/Sydney',
      locale: 'en-AU',
      bio: `Created by the live API suite run ${stamp}.`,
    },
    expect: 200,
    assert: (b) =>
      b?.firstName === 'Mock' ? undefined : `firstName was ${b?.firstName}`,
  });

  await client.call({
    name: 'profile update rejects an over-long field',
    method: 'PATCH',
    path: '/me/profile',
    actor: 'user',
    body: { firstName: 'x'.repeat(200) },
    expect: 400,
  });

  await client.call({
    name: 'profile update rejects a non-uuid avatar reference',
    method: 'PATCH',
    path: '/me/profile',
    actor: 'user',
    body: { avatarFileId: 'not-a-uuid' },
    expect: 400,
  });

  await client.call({
    name: 'the profile update is visible to admin',
    method: 'GET',
    path: '/users/{id}/profile',
    params: { id: user.userId },
    actor: 'admin',
    expect: 200,
    assert: (b) =>
      b?.firstName === 'Mock'
        ? undefined
        : `admin saw firstName ${b?.firstName}`,
  });

  // ------------------------------------------------------------- preferences

  const prefs: Array<{ key: string; value: unknown; type: string }> = [
    { key: 'ui.theme', value: 'dark', type: 'string' },
    { key: 'ui.density', value: 3, type: 'number' },
    { key: 'ui.betaOptIn', value: true, type: 'boolean' },
    { key: 'ui.layout', value: { sidebar: 'left', width: 280 }, type: 'json' },
  ];

  for (const pref of prefs) {
    await client.call({
      name: `user sets the ${pref.type} preference ${pref.key}`,
      method: 'PUT',
      path: '/me/preferences/{key}',
      params: { key: pref.key },
      actor: 'user',
      body: { value: pref.value, type: pref.type },
      expect: [200, 201, 204],
    });
  }

  await client.call({
    name: 'preference values are type-checked against the declared type',
    method: 'PUT',
    path: '/me/preferences/{key}',
    params: { key: 'ui.density' },
    actor: 'user',
    body: { value: 'not-a-number', type: 'number' },
    expect: [400, 422],
  });

  await client.call({
    name: 'user reads back every preference it set',
    method: 'GET',
    path: '/me/preferences',
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      const keys = new Set(rows.map((r) => r.key));
      const missing = prefs.map((p) => p.key).filter((k) => !keys.has(k));
      return missing.length ? `missing ${missing.join(', ')}` : undefined;
    },
  });

  await client.call({
    name: 'preferences are per-account, not global',
    method: 'GET',
    path: '/me/preferences',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((r) => r.key === 'ui.betaOptIn')
        ? 'admin sees a preference set by the mock user'
        : undefined;
    },
  });

  await client.call({
    name: 'user deletes a preference',
    method: 'DELETE',
    path: '/me/preferences/{key}',
    params: { key: 'ui.betaOptIn' },
    actor: 'user',
    expect: 204,
  });

  await client.call({
    name: 'the deleted preference is gone',
    method: 'GET',
    path: '/me/preferences',
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((r) => r.key === 'ui.betaOptIn')
        ? 'deleted preference still listed'
        : undefined;
    },
  });
}
