import type { Ctx } from '../harness/context';

/**
 * Tags — the shared vocabulary every other domain attaches to its records.
 *
 * Creation is admin-only while reading is open to users and agents, which is
 * the right shape for a controlled vocabulary: anyone may label with an
 * existing term, nobody may invent one in passing. This suite creates the three
 * tags the contacts, knowledge and projects suites go on to attach.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  // One tag per scope. Scope is enforced at attach time — a project-scoped tag
  // is refused on a task — so every domain suite needs its own.
  const created: Array<{
    scope: string;
    slot: 'tagContactId' | 'tagKnowledgeId' | 'tagProjectId' | 'tagTaskId';
  }> = [
    { scope: 'contact', slot: 'tagContactId' },
    { scope: 'knowledge', slot: 'tagKnowledgeId' },
    { scope: 'project', slot: 'tagProjectId' },
    { scope: 'task', slot: 'tagTaskId' },
  ];

  for (const { scope, slot } of created) {
    const res = await client.call({
      name: `admin creates a ${scope}-scoped tag`,
      method: 'POST',
      path: '/tags',
      actor: 'admin',
      body: {
        key: `apisuite-${scope}-${stamp}`,
        label: `API Suite ${scope}`,
        scope,
        color: '#4f46e5',
        description: `Created by the live API suite run ${stamp}.`,
      },
      expect: 201,
      assert: (b) => (b?.scope === scope ? undefined : `scope was ${b?.scope}`),
    });
    if (res.ok) ctx.ids[slot] = res.body.id;
  }

  await client.call({
    name: 'tag keys must match the slug pattern',
    method: 'POST',
    path: '/tags',
    actor: 'admin',
    body: { key: 'Not A Slug!', label: 'Invalid' },
    expect: 400,
  });

  await client.call({
    name: 'a duplicate tag key is refused',
    method: 'POST',
    path: '/tags',
    actor: 'admin',
    body: {
      key: `apisuite-contact-${stamp}`,
      label: 'Duplicate',
      scope: 'contact',
    },
    expect: [409, 400, 422],
  });

  await client.call({
    name: 'an unknown tag scope is refused',
    method: 'POST',
    path: '/tags',
    actor: 'admin',
    body: {
      key: `apisuite-badscope-${stamp}`,
      label: 'Bad scope',
      scope: 'galaxy',
    },
    expect: 400,
  });

  await client.call({
    name: 'a standard user cannot create tags',
    method: 'POST',
    path: '/tags',
    actor: 'user',
    body: { key: `apisuite-user-${stamp}`, label: 'User tag' },
    expect: 403,
  });

  await client.call({
    name: 'a standard user can read tags',
    method: 'GET',
    path: '/tags',
    actor: 'user',
    query: { page: 1, limit: 50 },
    expect: 200,
    assert: (b) =>
      Array.isArray(b?.data) ? undefined : 'expected a paginated envelope',
  });

  await client.call({
    name: 'an agent can read tags',
    method: 'GET',
    path: '/tags',
    actor: 'agent',
    expect: 200,
  });

  await client.call({
    name: 'tags can be filtered by scope',
    method: 'GET',
    path: '/tags',
    actor: 'user',
    query: { scope: 'contact', limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const foreign = rows.find((t) => t.scope !== 'contact');
      if (foreign) return `scope filter leaked a ${foreign.scope} tag`;
      return rows.some((t) => t.id === ctx.ids.tagContactId)
        ? undefined
        : 'the new contact tag is missing from its own scope';
    },
  });

  if (ctx.ids.tagContactId) {
    await client.call({
      name: 'a user reads a single tag',
      method: 'GET',
      path: '/tags/{id}',
      params: { id: ctx.ids.tagContactId },
      actor: 'user',
      expect: 200,
    });

    await client.call({
      name: 'admin relabels a tag',
      method: 'PATCH',
      path: '/tags/{id}',
      params: { id: ctx.ids.tagContactId },
      actor: 'admin',
      body: { label: 'API Suite contact (relabelled)', color: '#dc2626' },
      expect: 200,
      assert: (b) =>
        b?.label === 'API Suite contact (relabelled)'
          ? undefined
          : `label was ${b?.label}`,
    });

    await client.call({
      name: 'a standard user cannot relabel a tag',
      method: 'PATCH',
      path: '/tags/{id}',
      params: { id: ctx.ids.tagContactId },
      actor: 'user',
      body: { label: 'Hijacked' },
      expect: 403,
    });
  }

  await client.call({
    name: 'an unknown tag id is a 404',
    method: 'GET',
    path: '/tags/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'user',
    expect: 404,
  });

  // A fourth tag exists purely so DELETE is covered without removing a tag the
  // later suites are about to attach to their records.
  const disposable = await client.call({
    name: 'admin creates a disposable tag',
    method: 'POST',
    path: '/tags',
    actor: 'admin',
    body: {
      key: `apisuite-disposable-${stamp}`,
      label: 'Disposable',
      scope: 'shared',
    },
    expect: 201,
  });

  if (disposable.ok) {
    await client.call({
      name: 'a standard user cannot delete a tag',
      method: 'DELETE',
      path: '/tags/{id}',
      params: { id: disposable.body.id },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin deletes the disposable tag',
      method: 'DELETE',
      path: '/tags/{id}',
      params: { id: disposable.body.id },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the deleted tag is gone',
      method: 'GET',
      path: '/tags/{id}',
      params: { id: disposable.body.id },
      actor: 'admin',
      expect: 404,
    });
  }
}
