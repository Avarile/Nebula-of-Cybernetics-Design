import { create, type GenContext } from '../context';
import * as f from '../fake';
import { scaled, VOLUME } from '../volume';

/**
 * Comments and attachments across every entity type that accepts them.
 *
 * Deliberately spread over projects, tasks, knowledge, contacts and invoices:
 * comments and attachments resolve access through the EntityAccessRegistry, and
 * a corpus concentrated on one entity type would leave most of those resolvers
 * with nothing to answer for.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, pools } = ctx;
  client.beginSuite('collab');

  const targets: Array<{ type: string; ids: string[] }> = [
    { type: 'project', ids: pools.projectIds },
    { type: 'task', ids: pools.taskIds },
    { type: 'knowledge', ids: pools.knowledgeIds },
    { type: 'contact', ids: pools.contactIds },
    { type: 'invoice', ids: pools.invoiceIds },
  ].filter((t) => t.ids.length > 0);

  if (targets.length === 0) return;

  // Roots are tracked per entity, not globally: a reply must belong to the same
  // entity as its parent, and threading against a random earlier comment is a
  // 404 ("Parent comment does not belong to this entity").
  const rootsByEntity = new Map<string, string[]>();
  for (let i = 0; i < scaled(VOLUME.comments); i += 1) {
    const target = targets[i % targets.length];
    const entityId = f.pick(target.ids, i);
    const threadKey = `${target.type}:${entityId}`;
    const roots = rootsByEntity.get(threadKey) ?? [];
    const asReply = i % 4 === 3 && roots.length > 0;
    const id = await create(ctx, 'comments', {
      name: `comment ${i}`,
      method: 'POST',
      path: '/comments',
      // As the owner where we know one: a private contact or knowledge record
      // is genuinely invisible to the other principal, and the API says 404.
      actor: pools.owner.get(entityId) ?? 'admin',
      body: {
        entityType: target.type,
        entityId,
        body: asReply ? `Agreed — ${f.paragraph(i, 1)}` : f.paragraph(i, 2),
        ...(asReply ? { parentCommentId: f.pick(roots, i) } : {}),
        // Mentions are re-checked against the parent entity before dispatch,
        // so a mention of someone who cannot read it is dropped, not leaked.
        ...(i % 6 === 0 ? { mentionUserIds: [ctx.mockUserId] } : {}),
      },
      expect: [201, 200, 403],
    });
    if (id && !asReply) {
      roots.push(id);
      rootsByEntity.set(threadKey, roots);
    }
  }

  if (pools.fileIds.length === 0) return;

  const ATTACHABLE = [
    'project',
    'task',
    'knowledge',
    'contact',
    'invoice',
  ] as const;
  const KINDS = ['document', 'image', 'receipt', 'contract', 'other'] as const;
  for (let i = 0; i < scaled(VOLUME.attachments); i += 1) {
    const type = f.pick(ATTACHABLE, i);
    const pool = targets.find((t) => t.type === type);
    if (!pool) continue;
    const attachEntityId = f.pick(pool.ids, i);
    await create(ctx, 'entity_attachments', {
      name: `attachment ${i}`,
      method: 'POST',
      path: '/attachments',
      actor: pools.owner.get(attachEntityId) ?? 'admin',
      body: {
        entityType: type,
        entityId: attachEntityId,
        fileId: f.pick(pools.fileIds, i),
        kind: f.pick(KINDS, i),
        label: `Supporting material for ${f.topic(i)}`,
        sortOrder: i % 10,
      },
      expect: [201, 200, 403, 409],
    });
  }
}
