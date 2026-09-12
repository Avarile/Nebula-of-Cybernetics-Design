import { create, pickTags, tagsFor, type GenContext } from '../context';
import * as f from '../fake';
import { scaled, VOLUME } from '../volume';

/**
 * Knowledge records, their ACL grants and their links to contacts.
 *
 * Knowledge is grant-only: a record is invisible to everyone but its owner
 * until a row in `knowledge_access_control` says otherwise. Generating both
 * halves matters — records without grants would leave every shared-read path
 * untested.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp, pools } = ctx;
  client.beginSuite('knowledge');

  const knowledgeTags = tagsFor(pools, 'knowledge');
  const FORMATS = ['markdown', 'html', 'plain', 'link'] as const;
  const VISIBILITIES = ['private', 'restricted', 'internal'] as const;
  const total = scaled(VOLUME.knowledge.admin) + scaled(VOLUME.knowledge.user);

  for (let i = 0; i < total; i += 1) {
    const actor = i < scaled(VOLUME.knowledge.admin) ? 'admin' : 'user';
    const format = f.pick(FORMATS, i);
    const id = await create(ctx, 'knowledge', {
      name: `knowledge ${i}`,
      method: 'POST',
      path: '/knowledge',
      actor,
      body: {
        title: `${f.knowledgeTitle(i)} (${i})`,
        slug: f.slug('gen', i, stamp).slice(0, 200),
        summary: `A short account of ${f.topic(i)} for run ${stamp}.`,
        body:
          format === 'link'
            ? undefined
            : `# ${f.knowledgeTitle(i)}\n\n${f.paragraph(i, 6)}`,
        format,
        ...(format === 'link'
          ? { sourceUrl: `https://docs.example.com/${f.slug('ref', i, stamp)}` }
          : {}),
        visibility: f.pick(VISIBILITIES, i),
        language: 'en',
        reviewDueAt: f.isoDateTime((i % 90) - 20),
        ...(pools.knowledgeTypeIds.length
          ? { typeId: f.pick(pools.knowledgeTypeIds, i) }
          : {}),
        ...(pools.knowledgeCategoryIds.length
          ? { categoryId: f.pick(pools.knowledgeCategoryIds, i * 3) }
          : {}),
        // Fills knowledge_tags through the create call, scope-filtered.
        ...(knowledgeTags.length
          ? { tagIds: pickTags(knowledgeTags, 2, i) }
          : {}),
      },
      expect: 201,
    });
    if (id) {
      pools.knowledgeIds.push(id);
      pools.owner.set(id, actor);
    }
  }

  if (pools.knowledgeIds.length === 0) return;

  // A spread of statuses, so the review sweep and the published filters both
  // have something to act on rather than a wall of drafts.
  const STATUS_FLOW = [
    'in_review',
    'published',
    'archived',
    'deprecated',
  ] as const;
  for (let i = 0; i < Math.min(pools.knowledgeIds.length, 60); i += 1) {
    if (i % 2 === 1) continue;
    await create(ctx, 'knowledge_status', {
      name: `knowledge status ${i}`,
      method: 'POST',
      path: '/knowledge/{id}/status',
      params: { id: pools.knowledgeIds[i] },
      actor: 'admin',
      body: { status: f.pick(STATUS_FLOW, i) },
      expect: [200, 201, 204, 400, 403, 409, 422],
    });
  }

  const grantees = [ctx.mockUserId, ...pools.extraUserIds].filter(Boolean);
  const PERMISSIONS = ['read', 'comment', 'write', 'manage'] as const;
  for (let i = 0; i < scaled(VOLUME.knowledgeGrants); i += 1) {
    // Every third grant is to all authenticated users, which takes no grantee
    // id — the DTO refuses one, mirroring the CHECK constraint.
    const granteeType = i % 3 === 0 ? 'authenticated' : 'user';
    await create(ctx, 'knowledge_access_control', {
      name: `knowledge grant ${i}`,
      method: 'POST',
      path: '/knowledge/{id}/grants',
      params: { id: f.pick(pools.knowledgeIds, i) },
      actor: 'admin',
      body: {
        granteeType,
        ...(granteeType === 'user' && grantees.length
          ? { granteeUserId: f.pick(grantees, i) }
          : {}),
        permission: f.pick(PERMISSIONS, i),
        ...(i % 5 === 0 ? { expiresAt: f.isoDateTime(60 + i) } : {}),
      },
      expect: [201, 200, 204, 403, 409],
    });
  }

  if (pools.contactIds.length === 0) return;
  const RELATIONS = [
    'subject',
    'author',
    'source',
    'expert',
    'mentioned',
  ] as const;
  for (let i = 0; i < scaled(VOLUME.knowledgeContactLinks); i += 1) {
    await create(ctx, 'knowledge_contact_links', {
      name: `knowledge contact link ${i}`,
      method: 'POST',
      path: '/knowledge/{id}/contacts',
      params: { id: f.pick(pools.knowledgeIds, i * 3) },
      actor: 'admin',
      body: {
        contactId: f.pick(pools.contactIds, i * 7),
        relation: f.pick(RELATIONS, i),
        note: `Linked while writing up ${f.topic(i)}.`,
      },
      expect: [201, 200, 403, 409],
    });
  }
}
