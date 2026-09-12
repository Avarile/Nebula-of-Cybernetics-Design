import { isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * The knowledge base: vocabulary, records, the publish lifecycle, per-record
 * access grants, and links out to CRM contacts.
 *
 * The permission split is finer here than anywhere else — the baseline `user`
 * role carries read/create/update but neither `knowledge.publish`,
 * `knowledge.delete` nor `knowledge.manage_access` — so this suite is where the
 * mock user hits the most walls, deliberately.
 */
export async function run(ctx: Ctx): Promise<void> {
  await vocabulary(ctx);
  await records(ctx);
  await lifecycle(ctx);
  await grants(ctx);
  await contactLinks(ctx);
}

async function vocabulary(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  const type = await client.call({
    name: 'admin creates a knowledge type',
    method: 'POST',
    path: '/knowledge-vocabulary/types',
    actor: 'admin',
    body: {
      key: `apisuite-runbook-${stamp}`,
      name: 'API Suite Runbook',
      description: 'Knowledge type created by the live API suite.',
      icon: 'book',
      color: '#16a34a',
      defaultReviewIntervalDays: 90,
      sortOrder: 10,
    },
    expect: 201,
  });
  if (type.ok) ctx.ids.knowledgeTypeId = type.body.id;

  const category = await client.call({
    name: 'admin creates a knowledge category',
    method: 'POST',
    path: '/knowledge-vocabulary/categories',
    actor: 'admin',
    body: { key: `apisuite-ops-${stamp}`, name: 'API Suite Operations' },
    expect: 201,
  });
  if (category.ok) ctx.ids.knowledgeCategoryId = category.body.id;

  // `key` is optional: omitted, the server slugifies `name` into both the key
  // and the category's path segment.
  const derived = await client.call({
    name: 'admin creates a knowledge category without a key',
    method: 'POST',
    path: '/knowledge-vocabulary/categories',
    actor: 'admin',
    body: { name: `API Suite Derived ${stamp}` },
    expect: 201,
    assert: (body) => {
      const expected = `api-suite-derived-${stamp}`.toLowerCase();
      if (body.key !== expected)
        return `expected key ${expected}, got ${body.key}`;
      if (body.path !== `/${expected}`)
        return `expected path /${expected}, got ${body.path}`;
    },
  });
  if (derived.ok) {
    await client.call({
      name: 'a name that derives a taken key conflicts rather than auto-suffixing',
      method: 'POST',
      path: '/knowledge-vocabulary/categories',
      actor: 'admin',
      body: { name: `API Suite Derived ${stamp}` },
      expect: 409,
    });
    await client.call({
      name: 'admin deletes the derived-key knowledge category',
      method: 'DELETE',
      path: '/knowledge-vocabulary/categories/{id}',
      params: { id: derived.body.id },
      actor: 'admin',
      expect: 204,
    });
  }

  await client.call({
    name: 'a standard user cannot extend the knowledge vocabulary',
    method: 'POST',
    path: '/knowledge-vocabulary/types',
    actor: 'user',
    body: { key: `apisuite-nope-${stamp}`, name: 'Should not exist' },
    expect: 403,
  });

  await client.call({
    name: 'a standard user can read knowledge types',
    method: 'GET',
    path: '/knowledge-vocabulary/types',
    actor: 'user',
    expect: 200,
  });

  await client.call({
    name: 'an agent can read knowledge categories',
    method: 'GET',
    path: '/knowledge-vocabulary/categories',
    actor: 'agent',
    expect: 200,
  });

  if (ctx.ids.knowledgeTypeId) {
    await client.call({
      name: 'admin renames a knowledge type',
      method: 'PATCH',
      path: '/knowledge-vocabulary/types/{id}',
      params: { id: ctx.ids.knowledgeTypeId },
      actor: 'admin',
      body: {
        name: 'API Suite Runbook (renamed)',
        defaultReviewIntervalDays: 120,
      },
      expect: 200,
    });
  }

  if (ctx.ids.knowledgeCategoryId) {
    await client.call({
      name: 'admin renames a knowledge category',
      method: 'PATCH',
      path: '/knowledge-vocabulary/categories/{id}',
      params: { id: ctx.ids.knowledgeCategoryId },
      actor: 'admin',
      body: { name: 'API Suite Operations (renamed)' },
      expect: 200,
    });
  }

  for (const kind of ['types', 'categories'] as const) {
    const spare = await client.call({
      name: `admin creates a disposable knowledge ${kind.slice(0, -1)}`,
      method: 'POST',
      path: `/knowledge-vocabulary/${kind}`,
      actor: 'admin',
      body: { key: `apisuite-spare-k-${kind}-${stamp}`, name: 'Disposable' },
      expect: 201,
    });
    if (spare.ok) {
      await client.call({
        name: `admin deletes the disposable knowledge ${kind.slice(0, -1)}`,
        method: 'DELETE',
        path: `/knowledge-vocabulary/${kind}/{id}`,
        params: { id: spare.body.id },
        actor: 'admin',
        expect: 204,
      });
    }
  }
}

async function records(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  const record = await client.call({
    name: 'user creates a knowledge record',
    method: 'POST',
    path: '/knowledge',
    actor: 'user',
    body: {
      title: `Incident Response Runbook ${stamp}`,
      slug: `incident-response-runbook-${stamp}`,
      summary: 'How the on-call rotation handles a production incident.',
      body: [
        '# Incident Response',
        '',
        '1. Acknowledge the page.',
        '2. Declare severity.',
        '3. Open a channel and start a timeline.',
        '',
        'Written by the live API suite.',
      ].join('\n'),
      format: 'markdown',
      typeId: ctx.ids.knowledgeTypeId,
      categoryId: ctx.ids.knowledgeCategoryId,
      visibility: 'internal',
      language: 'en',
      reviewDueAt: isoDateTime(90),
      tagIds: ctx.ids.tagKnowledgeId ? [ctx.ids.tagKnowledgeId] : undefined,
    },
    expect: 201,
    assert: (b) => {
      if (b?.status && b.status !== 'draft')
        return `new records should start as draft, got ${b.status}`;
      return undefined;
    },
  });
  if (record.ok) ctx.ids.knowledgeId = record.body.id;

  await client.call({
    name: 'knowledge creation requires a title',
    method: 'POST',
    path: '/knowledge',
    actor: 'user',
    body: { summary: 'No title here' },
    expect: 400,
  });

  await client.call({
    name: 'a malformed slug is rejected',
    method: 'POST',
    path: '/knowledge',
    actor: 'user',
    body: { title: 'Bad slug', slug: 'Not A Slug' },
    expect: 400,
  });

  await client.call({
    name: 'an unknown knowledge format is rejected',
    method: 'POST',
    path: '/knowledge',
    actor: 'user',
    body: { title: 'Bad format', format: 'papyrus' },
    expect: 400,
  });

  await client.call({
    name: 'user lists knowledge with the access-filtered envelope',
    method: 'GET',
    path: '/knowledge',
    actor: 'user',
    query: { page: 1, limit: 20 },
    expect: 200,
    assert: (b) => {
      if (!Array.isArray(b?.data)) return 'expected a paginated envelope';
      if (typeof b.totalBeforeAccess !== 'number') {
        return 'expected totalBeforeAccess so callers can see access filtering';
      }
      return undefined;
    },
  });

  await client.call({
    name: 'user searches knowledge by title',
    method: 'GET',
    path: '/knowledge',
    actor: 'user',
    query: { search: 'Incident Response', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((k) => k.id === ctx.ids.knowledgeId)
        ? undefined
        : 'search did not find the record just created';
    },
  });

  await client.call({
    name: 'user filters knowledge by status',
    method: 'GET',
    path: '/knowledge',
    actor: 'user',
    query: { status: 'draft', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const wrong = rows.find((k) => k.status !== 'draft');
      return wrong
        ? `status filter leaked a ${wrong.status} record`
        : undefined;
    },
  });

  await client.call({
    name: 'user filters knowledge by tag',
    method: 'GET',
    path: '/knowledge',
    actor: 'user',
    query: { tagId: ctx.ids.tagKnowledgeId, limit: 20 },
    expect: 200,
  });

  if (!ctx.ids.knowledgeId) return;
  const id = ctx.ids.knowledgeId;

  const fetched = await client.call({
    name: 'user reads the knowledge record',
    method: 'GET',
    path: '/knowledge/{id}',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => (b?.body ? undefined : 'the record body was not returned'),
  });

  await client.call({
    name: 'user updates the knowledge record',
    method: 'PATCH',
    path: '/knowledge/{id}',
    params: { id },
    actor: 'user',
    body: { summary: 'Revised by the live API suite.' },
    expect: 200,
    assert: (b) =>
      b?.summary === 'Revised by the live API suite.'
        ? undefined
        : `summary was ${b?.summary}`,
  });

  // `version` is a *content* version: it advances on a title or body edit and
  // deliberately not on metadata. So the stale-write check needs a real content
  // edit in front of it, otherwise the "stale" version is still current.
  const version = fetched.body?.version;
  if (typeof version === 'number') {
    await client.call({
      name: 'a metadata-only edit does not advance the content version',
      method: 'PATCH',
      path: '/knowledge/{id}',
      params: { id },
      actor: 'user',
      body: { language: 'en' },
      expect: 200,
      assert: (b) =>
        b?.version === version ? undefined : `version moved to ${b?.version}`,
    });

    await client.call({
      name: 'a body edit advances the content version',
      method: 'PATCH',
      path: '/knowledge/{id}',
      params: { id },
      actor: 'user',
      body: { body: '# Incident Response\n\nRevision two.' },
      expect: 200,
      assert: (b) =>
        b?.version === version + 1
          ? undefined
          : `version was ${b?.version}, wanted ${version + 1}`,
    });

    await client.call({
      name: 'a stale expectedVersion is rejected',
      method: 'PATCH',
      path: '/knowledge/{id}',
      params: { id },
      actor: 'user',
      body: { body: 'Stale write', expectedVersion: version },
      expect: [409, 412],
    });

    await client.call({
      name: 'the current expectedVersion is accepted',
      method: 'PATCH',
      path: '/knowledge/{id}',
      params: { id },
      actor: 'user',
      body: {
        summary: 'Revised by the live API suite.',
        expectedVersion: version + 1,
      },
      expect: 200,
    });
  }

  await client.call({
    name: 'an agent cannot create knowledge without the grant',
    method: 'POST',
    path: '/knowledge',
    actor: 'agent',
    body: { title: `Agent record ${stamp}` },
    expect: 403,
  });

  await client.call({
    name: 'an unknown knowledge id is a 404',
    method: 'GET',
    path: '/knowledge/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'user',
    expect: 404,
  });
}

async function lifecycle(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  if (!ctx.ids.knowledgeId) {
    client.skip(
      'knowledge lifecycle',
      '/knowledge/{id}/status',
      'POST',
      'no record was created',
    );
    return;
  }
  const id = ctx.ids.knowledgeId;

  await client.call({
    name: 'a standard user cannot publish (no knowledge.publish grant)',
    method: 'POST',
    path: '/knowledge/{id}/status',
    params: { id },
    actor: 'user',
    body: { status: 'published' },
    expect: 403,
  });

  await client.call({
    name: 'admin moves the record into review',
    method: 'POST',
    path: '/knowledge/{id}/status',
    params: { id },
    actor: 'admin',
    body: { status: 'in_review', note: 'Queued by the live API suite.' },
    expect: [200, 201],
    assert: (b) =>
      b?.status === 'in_review' ? undefined : `status was ${b?.status}`,
  });

  await client.call({
    name: 'admin publishes the record',
    method: 'POST',
    path: '/knowledge/{id}/status',
    params: { id },
    actor: 'admin',
    body: { status: 'published' },
    expect: [200, 201],
    assert: (b) =>
      b?.status === 'published' ? undefined : `status was ${b?.status}`,
  });

  await client.call({
    name: 'an unknown status is rejected',
    method: 'POST',
    path: '/knowledge/{id}/status',
    params: { id },
    actor: 'admin',
    body: { status: 'canonised' },
    expect: 400,
  });

  await client.call({
    name: 'the published record shows up under a published filter',
    method: 'GET',
    path: '/knowledge',
    actor: 'user',
    query: { status: 'published', limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((k) => k.id === id)
        ? undefined
        : 'the published record is missing from the published filter';
    },
  });

  // A disposable record covers the admin-only delete path.
  const spare = await client.call({
    name: 'user creates a disposable knowledge record',
    method: 'POST',
    path: '/knowledge',
    actor: 'user',
    body: { title: `Disposable Note ${stamp}` },
    expect: 201,
  });

  if (spare.ok) {
    await client.call({
      name: 'a standard user cannot delete knowledge',
      method: 'DELETE',
      path: '/knowledge/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin deletes the disposable record',
      method: 'DELETE',
      path: '/knowledge/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the deleted record is gone',
      method: 'GET',
      path: '/knowledge/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 404,
    });
  }
}

async function grants(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.knowledgeId) {
    client.skip(
      'knowledge grants',
      '/knowledge/{id}/grants',
      'POST',
      'no record was created',
    );
    return;
  }
  const id = ctx.ids.knowledgeId;

  await client.call({
    name: 'a standard user cannot manage access grants',
    method: 'GET',
    path: '/knowledge/{id}/grants',
    params: { id },
    actor: 'user',
    expect: 403,
  });

  const grant = await client.call({
    name: 'admin grants a second user read access',
    method: 'POST',
    path: '/knowledge/{id}/grants',
    params: { id },
    actor: 'admin',
    body: {
      granteeType: 'user',
      granteeUserId: ctx.ids.secondUserId ?? ctx.ids.mockUserId,
      permission: 'read',
    },
    expect: 201,
  });
  if (grant.ok) ctx.ids.knowledgeGrantId = grant.body.id;

  await client.call({
    name: 'a user grant without a grantee id is rejected',
    method: 'POST',
    path: '/knowledge/{id}/grants',
    params: { id },
    actor: 'admin',
    body: { granteeType: 'user', permission: 'read' },
    expect: [400, 422],
  });

  await client.call({
    name: 'an unknown grantee type is rejected',
    method: 'POST',
    path: '/knowledge/{id}/grants',
    params: { id },
    actor: 'admin',
    body: { granteeType: 'everyone', permission: 'read' },
    expect: 400,
  });

  await client.call({
    name: 'admin lists the record’s grants',
    method: 'GET',
    path: '/knowledge/{id}/grants',
    params: { id },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0
        ? undefined
        : 'the grant just created is not listed';
    },
  });

  if (ctx.ids.knowledgeGrantId) {
    await client.call({
      name: 'admin revokes the grant',
      method: 'DELETE',
      path: '/knowledge/{id}/grants/{grantId}',
      params: { id, grantId: ctx.ids.knowledgeGrantId },
      actor: 'admin',
      expect: 204,
    });
  }
}

async function contactLinks(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.knowledgeId || !ctx.ids.contactId) {
    client.skip(
      'knowledge/contact links',
      '/knowledge/{id}/contacts',
      'POST',
      'a knowledge record and a contact are both required',
    );
    return;
  }
  const id = ctx.ids.knowledgeId;

  const link = await client.call({
    name: 'user links a contact to the record as its subject-matter expert',
    method: 'POST',
    path: '/knowledge/{id}/contacts',
    params: { id },
    actor: 'user',
    body: {
      contactId: ctx.ids.contactId,
      relation: 'expert',
      note: 'Reviewed the runbook.',
    },
    expect: 201,
  });
  if (link.ok) ctx.ids.knowledgeContactLinkId = link.body.id;

  await client.call({
    name: 'an unknown relation is rejected',
    method: 'POST',
    path: '/knowledge/{id}/contacts',
    params: { id },
    actor: 'user',
    body: { contactId: ctx.ids.contactId, relation: 'oracle' },
    expect: 400,
  });

  await client.call({
    name: 'user lists the record’s linked contacts',
    method: 'GET',
    path: '/knowledge/{id}/contacts',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0
        ? undefined
        : 'the link just created is not listed';
    },
  });

  if (ctx.ids.knowledgeContactLinkId) {
    await client.call({
      name: 'user removes the contact link',
      method: 'DELETE',
      path: '/knowledge/{id}/contacts/{linkId}',
      params: { id, linkId: ctx.ids.knowledgeContactLinkId },
      actor: 'user',
      expect: 204,
    });
  }
}
