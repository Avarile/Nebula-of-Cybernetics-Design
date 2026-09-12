import { isoDate, isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * CRM: the controlled vocabulary, companies, contacts, and the three things
 * that hang off a contact — channels, relationships and interactions.
 *
 * The mock user does the creating here. Its baseline role carries
 * `contact.create` and `contact.update` but not `contact.delete` on companies,
 * so the suite alternates actors deliberately rather than doing everything as
 * admin: a CRM that only works for administrators is not a working CRM.
 */
export async function run(ctx: Ctx): Promise<void> {
  await vocabulary(ctx);
  await companies(ctx);
  await contacts(ctx);
  await channels(ctx);
  await relationships(ctx);
  await interactions(ctx);
}

async function vocabulary(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  const type = await client.call({
    name: 'admin creates a contact type',
    method: 'POST',
    path: '/contact-vocabulary/types',
    actor: 'admin',
    body: {
      key: `apisuite-lead-${stamp}`,
      name: 'API Suite Lead',
      description: 'Contact type created by the live API suite.',
      color: '#0ea5e9',
      sortOrder: 10,
    },
    expect: 201,
  });
  if (type.ok) ctx.ids.contactTypeId = type.body.id;

  const category = await client.call({
    name: 'admin creates a contact category',
    method: 'POST',
    path: '/contact-vocabulary/categories',
    actor: 'admin',
    body: {
      key: `apisuite-strategic-${stamp}`,
      name: 'API Suite Strategic',
      sortOrder: 5,
    },
    expect: 201,
  });
  if (category.ok) ctx.ids.contactCategoryId = category.body.id;

  await client.call({
    name: 'a standard user cannot extend the contact vocabulary',
    method: 'POST',
    path: '/contact-vocabulary/types',
    actor: 'user',
    body: { key: `apisuite-user-${stamp}`, name: 'Should not exist' },
    expect: 403,
  });

  await client.call({
    name: 'a standard user can read contact types',
    method: 'GET',
    path: '/contact-vocabulary/types',
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((t) => t.id === ctx.ids.contactTypeId)
        ? undefined
        : 'the new type is not visible to users';
    },
  });

  await client.call({
    name: 'an agent can read contact categories',
    method: 'GET',
    path: '/contact-vocabulary/categories',
    actor: 'agent',
    expect: 200,
  });

  if (ctx.ids.contactTypeId) {
    await client.call({
      name: 'admin renames a contact type',
      method: 'PATCH',
      path: '/contact-vocabulary/types/{id}',
      params: { id: ctx.ids.contactTypeId },
      actor: 'admin',
      body: { name: 'API Suite Lead (renamed)', sortOrder: 11 },
      expect: 200,
    });
  }

  if (ctx.ids.contactCategoryId) {
    await client.call({
      name: 'admin renames a contact category',
      method: 'PATCH',
      path: '/contact-vocabulary/categories/{id}',
      params: { id: ctx.ids.contactCategoryId },
      actor: 'admin',
      body: { name: 'API Suite Strategic (renamed)' },
      expect: 200,
    });
  }

  // Disposable vocabulary entries, so DELETE is covered without breaking the
  // contacts that are about to reference the ones above.
  for (const kind of ['types', 'categories'] as const) {
    const spare = await client.call({
      name: `admin creates a disposable contact ${kind.slice(0, -1)}`,
      method: 'POST',
      path: `/contact-vocabulary/${kind}`,
      actor: 'admin',
      body: { key: `apisuite-spare-${kind}-${stamp}`, name: 'Disposable' },
      expect: 201,
    });
    if (spare.ok) {
      await client.call({
        name: `admin deletes the disposable contact ${kind.slice(0, -1)}`,
        method: 'DELETE',
        path: `/contact-vocabulary/${kind}/{id}`,
        params: { id: spare.body.id },
        actor: 'admin',
        expect: 204,
      });
    }
  }
}

async function companies(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  const company = await client.call({
    name: 'user creates a company',
    method: 'POST',
    path: '/companies',
    actor: 'user',
    body: {
      name: `Northwind Analytics ${stamp}`,
      legalName: 'Northwind Analytics Pty Ltd',
      domain: `northwind-${stamp}.test`,
      industry: 'Software',
      size: 'small',
      website: `https://northwind-${stamp}.test`,
      phone: '+61 2 5550 0100',
      country: 'AU',
      status: 'active',
      description: 'Fixture company created by the live API suite.',
      taxNumber: '12 345 678 901',
    },
    expect: 201,
  });
  if (company.ok) ctx.ids.companyId = company.body.id;

  await client.call({
    name: 'company creation requires a name',
    method: 'POST',
    path: '/companies',
    actor: 'user',
    body: { industry: 'Software' },
    expect: 400,
  });

  await client.call({
    name: 'an unknown company size is rejected',
    method: 'POST',
    path: '/companies',
    actor: 'user',
    body: { name: `Bad Size ${stamp}`, size: 'gigantic' },
    expect: 400,
  });

  await client.call({
    name: 'user searches companies by name',
    method: 'GET',
    path: '/companies',
    actor: 'user',
    query: { search: `Northwind Analytics ${stamp}`, page: 1, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((c) => c.id === ctx.ids.companyId)
        ? undefined
        : 'search did not find the company just created';
    },
  });

  if (ctx.ids.companyId) {
    await client.call({
      name: 'user reads the company',
      method: 'GET',
      path: '/companies/{id}',
      params: { id: ctx.ids.companyId },
      actor: 'user',
      expect: 200,
    });

    await client.call({
      name: 'user updates the company',
      method: 'PATCH',
      path: '/companies/{id}',
      params: { id: ctx.ids.companyId },
      actor: 'user',
      body: { industry: 'Data Analytics', size: 'medium' },
      expect: 200,
      assert: (b) => (b?.size === 'medium' ? undefined : `size was ${b?.size}`),
    });

    await client.call({
      name: 'company deletion is admin-only',
      method: 'DELETE',
      path: '/companies/{id}',
      params: { id: ctx.ids.companyId },
      actor: 'user',
      expect: 403,
    });
  }

  // A disposable company covers the admin-only delete path.
  const spare = await client.call({
    name: 'user creates a disposable company',
    method: 'POST',
    path: '/companies',
    actor: 'user',
    body: { name: `Disposable Holdings ${stamp}` },
    expect: 201,
  });
  if (spare.ok) {
    await client.call({
      name: 'admin deletes the disposable company',
      method: 'DELETE',
      path: '/companies/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 204,
    });
    await client.call({
      name: 'the deleted company is gone',
      method: 'GET',
      path: '/companies/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 404,
    });
  }
}

async function contacts(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  const primary = await client.call({
    name: 'user creates a fully populated contact',
    method: 'POST',
    path: '/contacts',
    actor: 'user',
    body: {
      firstName: 'Ada',
      lastName: 'Okonkwo',
      displayName: `Ada Okonkwo ${stamp}`,
      salutation: 'Dr',
      primaryEmail: `ada.${stamp}@northwind.test`,
      primaryPhone: '+61 400 000 111',
      jobTitle: 'Head of Data',
      companyId: ctx.ids.companyId,
      typeId: ctx.ids.contactTypeId,
      categoryId: ctx.ids.contactCategoryId,
      status: 'active',
      source: 'manual',
      visibility: 'shared',
      address: {
        line1: '1 Test Parade',
        city: 'Sydney',
        region: 'NSW',
        postalCode: '2000',
        country: 'Australia',
      },
      country: 'AU',
      timezone: 'Australia/Sydney',
      language: 'en',
      birthday: isoDate(-10_000),
      notes: 'Primary CRM fixture for the live API suite.',
      nextFollowUpAt: isoDateTime(14),
      tagIds: ctx.ids.tagContactId ? [ctx.ids.tagContactId] : undefined,
    },
    expect: 201,
    assert: (b) => {
      if (b?.companyId !== ctx.ids.companyId)
        return 'companyId did not persist';
      return undefined;
    },
  });
  if (primary.ok) ctx.ids.contactId = primary.body.id;

  const second = await client.call({
    name: 'user creates a second contact for relationship tests',
    method: 'POST',
    path: '/contacts',
    actor: 'user',
    body: {
      firstName: 'Bruno',
      lastName: 'Faretti',
      displayName: `Bruno Faretti ${stamp}`,
      primaryEmail: `bruno.${stamp}@northwind.test`,
      companyId: ctx.ids.companyId,
      status: 'active',
    },
    expect: 201,
  });
  if (second.ok) ctx.ids.contactTwoId = second.body.id;

  await client.call({
    name: 'a malformed contact email is rejected',
    method: 'POST',
    path: '/contacts',
    actor: 'user',
    body: { displayName: 'Bad Email', primaryEmail: 'not-an-email' },
    expect: 400,
  });

  await client.call({
    name: 'an unknown contact status is rejected',
    method: 'POST',
    path: '/contacts',
    actor: 'user',
    body: { displayName: 'Bad Status', status: 'thinking-about-it' },
    expect: 400,
  });

  // FINDING: a dangling foreign key surfaces as 500. `mapInfraError` maps the
  // unique-violation SQLSTATE (23505) but not the foreign-key one (23503), so
  // the driver error falls through to INTERNAL_ERROR instead of becoming a
  // client error. Asserted as it should behave, so the fix flips this green.
  await client.call({
    name: 'a contact cannot reference a company that does not exist',
    method: 'POST',
    path: '/contacts',
    actor: 'user',
    body: {
      displayName: 'Orphan',
      companyId: '00000000-0000-4000-8000-000000000000',
    },
    expect: [400, 404, 409, 422],
  });

  await client.call({
    name: 'user filters contacts by company',
    method: 'GET',
    path: '/contacts',
    actor: 'user',
    query: { companyId: ctx.ids.companyId, page: 1, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      if (rows.length < 2)
        return `expected both fixture contacts, got ${rows.length}`;
      const foreign = rows.find((c) => c.companyId !== ctx.ids.companyId);
      return foreign ? 'company filter leaked a contact' : undefined;
    },
  });

  await client.call({
    name: 'user filters contacts by tag',
    method: 'GET',
    path: '/contacts',
    actor: 'user',
    query: { tagId: ctx.ids.tagContactId, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((c) => c.id === ctx.ids.contactId)
        ? undefined
        : 'the tagged contact is not returned by its own tag filter';
    },
  });

  await client.call({
    name: 'user searches contacts by name',
    method: 'GET',
    path: '/contacts',
    actor: 'user',
    query: { search: 'Okonkwo', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((c) => c.id === ctx.ids.contactId)
        ? undefined
        : 'search did not find the contact by surname';
    },
  });

  await client.call({
    name: 'an agent can read contacts',
    method: 'GET',
    path: '/contacts',
    actor: 'agent',
    query: { limit: 5 },
    expect: 200,
  });

  if (ctx.ids.contactId) {
    await client.call({
      name: 'user reads the contact',
      method: 'GET',
      path: '/contacts/{id}',
      params: { id: ctx.ids.contactId },
      actor: 'user',
      expect: 200,
    });

    await client.call({
      name: 'user updates the contact',
      method: 'PATCH',
      path: '/contacts/{id}',
      params: { id: ctx.ids.contactId },
      actor: 'user',
      body: { jobTitle: 'Chief Data Officer', status: 'active' },
      expect: 200,
      assert: (b) =>
        b?.jobTitle === 'Chief Data Officer'
          ? undefined
          : `jobTitle was ${b?.jobTitle}`,
    });

    await client.call({
      name: 'an agent cannot update a contact',
      method: 'PATCH',
      path: '/contacts/{id}',
      params: { id: ctx.ids.contactId },
      actor: 'agent',
      body: { jobTitle: 'Hijacked' },
      expect: 403,
    });
  }

  await client.call({
    name: 'an unknown contact id is a 404',
    method: 'GET',
    path: '/contacts/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'user',
    expect: 404,
  });

  const spare = await client.call({
    name: 'user creates a disposable contact',
    method: 'POST',
    path: '/contacts',
    actor: 'user',
    body: { displayName: `Disposable Contact ${stamp}` },
    expect: 201,
  });
  if (spare.ok) {
    // The baseline `user` role carries contact read/create/update but not
    // `contact.delete`, so a standard account may create a contact it then
    // cannot remove. Asserted rather than worked around, because that is a
    // deliberate shape of the seeded role and worth noticing if it changes.
    await client.call({
      name: 'a standard user cannot delete a contact it created',
      method: 'DELETE',
      path: '/contacts/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin deletes the disposable contact',
      method: 'DELETE',
      path: '/contacts/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 204,
    });
    await client.call({
      name: 'the deleted contact is gone',
      method: 'GET',
      path: '/contacts/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 404,
    });
  }
}

async function channels(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  if (!ctx.ids.contactId) {
    client.skip(
      'contact channels',
      '/contacts/{id}/channels',
      'POST',
      'no contact was created',
    );
    return;
  }
  const id = ctx.ids.contactId;

  const channel = await client.call({
    name: 'user adds a primary email channel',
    method: 'POST',
    path: '/contacts/{id}/channels',
    params: { id },
    actor: 'user',
    body: {
      kind: 'email',
      value: `ada.work.${stamp}@northwind.test`,
      label: 'Work',
      isPrimary: true,
    },
    expect: 201,
  });
  if (channel.ok) ctx.ids.channelId = channel.body.id;

  await client.call({
    name: 'user adds a second channel of a different kind',
    method: 'POST',
    path: '/contacts/{id}/channels',
    params: { id },
    actor: 'user',
    body: { kind: 'linkedin', value: `https://linkedin.test/in/ada-${stamp}` },
    expect: 201,
  });

  await client.call({
    name: 'an unknown channel kind is rejected',
    method: 'POST',
    path: '/contacts/{id}/channels',
    params: { id },
    actor: 'user',
    body: { kind: 'carrier-pigeon', value: 'coop 3' },
    expect: 400,
  });

  await client.call({
    name: 'user lists the contact’s channels',
    method: 'GET',
    path: '/contacts/{id}/channels',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length < 2) return `expected 2 channels, got ${rows.length}`;
      return rows.some((c) => c.isPrimary)
        ? undefined
        : 'no channel is marked primary';
    },
  });

  if (ctx.ids.channelId) {
    await client.call({
      name: 'user removes a channel',
      method: 'DELETE',
      path: '/contacts/{id}/channels/{channelId}',
      params: { id, channelId: ctx.ids.channelId },
      actor: 'user',
      expect: 204,
    });
  }
}

async function relationships(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.contactId || !ctx.ids.contactTwoId) {
    client.skip(
      'contact relationships',
      '/contacts/{id}/relationships',
      'POST',
      'two contacts are required',
    );
    return;
  }
  const id = ctx.ids.contactId;

  const rel = await client.call({
    name: 'user links two contacts as colleagues',
    method: 'POST',
    path: '/contacts/{id}/relationships',
    params: { id },
    actor: 'user',
    body: {
      toContactId: ctx.ids.contactTwoId,
      type: 'colleague',
      strength: 'strong',
      since: isoDate(-365),
      note: 'Worked together on the fixture dataset.',
    },
    expect: 201,
  });
  if (rel.ok) ctx.ids.relationshipId = rel.body.id;

  await client.call({
    name: 'a relationship to an unknown contact is refused',
    method: 'POST',
    path: '/contacts/{id}/relationships',
    params: { id },
    actor: 'user',
    body: {
      toContactId: '00000000-0000-4000-8000-000000000000',
      type: 'colleague',
    },
    expect: [400, 404, 409, 422],
  });

  await client.call({
    name: 'an unknown relationship type is rejected',
    method: 'POST',
    path: '/contacts/{id}/relationships',
    params: { id },
    actor: 'user',
    body: { toContactId: ctx.ids.contactTwoId, type: 'nemesis' },
    expect: 400,
  });

  await client.call({
    name: 'user lists the contact’s relationships',
    method: 'GET',
    path: '/contacts/{id}/relationships',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0
        ? undefined
        : 'the relationship just created is not listed';
    },
  });

  if (ctx.ids.relationshipId) {
    await client.call({
      name: 'user removes the relationship',
      method: 'DELETE',
      path: '/contacts/{id}/relationships/{relationshipId}',
      params: { id, relationshipId: ctx.ids.relationshipId },
      actor: 'user',
      expect: 204,
    });
  }
}

async function interactions(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.contactId) {
    client.skip(
      'contact interactions',
      '/contacts/{id}/interactions',
      'POST',
      'no contact was created',
    );
    return;
  }
  const id = ctx.ids.contactId;

  const kinds: Array<[string, string]> = [
    ['meeting', 'Kickoff meeting'],
    ['call', 'Follow-up call'],
    ['note', 'Internal note on account strategy'],
  ];

  let firstId: string | undefined;
  for (const [kind, subject] of kinds) {
    const res = await client.call({
      name: `user logs a ${kind} interaction`,
      method: 'POST',
      path: '/contacts/{id}/interactions',
      params: { id },
      actor: 'user',
      body: {
        kind,
        occurredAt: isoDateTime(-1),
        subject,
        body: `${subject} — recorded by the live API suite.`,
        direction: kind === 'note' ? 'internal' : 'outbound',
        durationMinutes: kind === 'note' ? undefined : 30,
      },
      expect: 201,
    });
    if (res.ok && !firstId) firstId = res.body.id;
  }
  ctx.ids.interactionId = firstId;

  await client.call({
    name: 'an unknown interaction kind is rejected',
    method: 'POST',
    path: '/contacts/{id}/interactions',
    params: { id },
    actor: 'user',
    body: { kind: 'telepathy' },
    expect: 400,
  });

  await client.call({
    name: 'an agent can log an interaction',
    method: 'POST',
    path: '/contacts/{id}/interactions',
    params: { id },
    actor: 'agent',
    body: { kind: 'note', subject: 'Agent-recorded note' },
    expect: [201, 403],
  });

  await client.call({
    name: 'user reads the interaction history',
    method: 'GET',
    path: '/contacts/{id}/interactions',
    params: { id },
    actor: 'user',
    query: { page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.length >= 3
        ? undefined
        : `expected at least 3 interactions, got ${rows.length}`;
    },
  });

  if (firstId) {
    await client.call({
      name: 'user deletes an interaction',
      method: 'DELETE',
      path: '/contacts/{id}/interactions/{interactionId}',
      params: { id, interactionId: firstId },
      actor: 'user',
      expect: 204,
    });
  }
}
