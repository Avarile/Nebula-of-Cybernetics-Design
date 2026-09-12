import type { Ctx } from '../harness/context';

/**
 * The three polymorphic, cross-cutting surfaces: comments, attachments and the
 * activity feed.
 *
 * Comments and attachments carry no access rules of their own — readability is
 * entirely the parent record's, resolved through the EntityAccessRegistry. The
 * checks that matter here are therefore the ones that point a comment at an
 * entity the caller cannot see, and the one that points it at an entity id that
 * does not exist at all.
 */
export async function run(ctx: Ctx): Promise<void> {
  await comments(ctx);
  await attachments(ctx);
  await activity(ctx);
}

async function comments(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  if (!ctx.ids.taskId) {
    client.skip('comments', '/comments', 'POST', 'no task to comment on');
    return;
  }
  const entityId = ctx.ids.taskId;

  const comment = await client.call({
    name: 'user comments on a task',
    method: 'POST',
    path: '/comments',
    actor: 'user',
    body: {
      entityType: 'task',
      entityId,
      body: `Starting on the ingest worker now. (run ${stamp})`,
    },
    expect: 201,
  });
  if (comment.ok) ctx.ids.commentId = comment.body.id;

  if (ctx.ids.commentId) {
    const reply = await client.call({
      name: 'admin replies in the thread and mentions the mock user',
      method: 'POST',
      path: '/comments',
      actor: 'admin',
      body: {
        entityType: 'task',
        entityId,
        body: 'Acknowledged — ping me when the queue is up.',
        parentCommentId: ctx.ids.commentId,
        mentionUserIds: ctx.ids.mockUserId ? [ctx.ids.mockUserId] : undefined,
      },
      expect: 201,
    });
    if (reply.ok) ctx.ids.replyCommentId = reply.body.id;
  }

  await client.call({
    name: 'an empty comment body is rejected',
    method: 'POST',
    path: '/comments',
    actor: 'user',
    body: { entityType: 'task', entityId, body: '' },
    expect: 400,
  });

  await client.call({
    name: 'an unknown entity type is rejected',
    method: 'POST',
    path: '/comments',
    actor: 'user',
    body: { entityType: 'spreadsheet', entityId, body: 'Nope' },
    expect: 400,
  });

  await client.call({
    name: 'a comment on an entity that does not exist is refused',
    method: 'POST',
    path: '/comments',
    actor: 'user',
    body: {
      entityType: 'task',
      entityId: '00000000-0000-4000-8000-000000000000',
      body: 'Into the void',
    },
    expect: [400, 403, 404, 409, 422],
  });

  await client.call({
    name: 'listing comments requires naming the parent entity',
    method: 'GET',
    path: '/comments',
    actor: 'user',
    expect: 400,
  });

  await client.call({
    name: 'user reads the task’s comment thread',
    method: 'GET',
    path: '/comments',
    actor: 'user',
    query: { entityType: 'task', entityId, page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      if (rows.length < 2)
        return `expected the comment and its reply, got ${rows.length}`;
      return rows.some((c) => c.parentCommentId === ctx.ids.commentId)
        ? undefined
        : 'the reply is not threaded under its parent';
    },
  });

  await client.call({
    name: 'an agent can read comments',
    method: 'GET',
    path: '/comments',
    actor: 'agent',
    query: { entityType: 'task', entityId, limit: 10 },
    expect: 200,
  });

  if (ctx.ids.commentId) {
    await client.call({
      name: 'user edits its own comment',
      method: 'PATCH',
      path: '/comments/{id}',
      params: { id: ctx.ids.commentId },
      actor: 'user',
      body: { body: 'Starting on the ingest worker now. (edited)' },
      expect: 200,
      assert: (b) =>
        String(b?.body ?? '').includes('(edited)')
          ? undefined
          : 'the edit did not persist',
    });
  }

  if (ctx.ids.replyCommentId) {
    await client.call({
      name: 'a user cannot edit somebody else’s comment',
      method: 'PATCH',
      path: '/comments/{id}',
      params: { id: ctx.ids.replyCommentId },
      actor: 'user',
      body: { body: 'Rewriting history' },
      expect: [403, 404],
    });

    await client.call({
      name: 'admin deletes its own reply',
      method: 'DELETE',
      path: '/comments/{id}',
      params: { id: ctx.ids.replyCommentId },
      actor: 'admin',
      expect: 204,
    });
  }

  // Comments also hang off knowledge and contacts; cover a second parent type
  // so the polymorphic resolver is exercised on more than one registration.
  if (ctx.ids.knowledgeId) {
    await client.call({
      name: 'user comments on a knowledge record',
      method: 'POST',
      path: '/comments',
      actor: 'user',
      body: {
        entityType: 'knowledge',
        entityId: ctx.ids.knowledgeId,
        body: 'Runbook step 2 needs a severity matrix.',
      },
      expect: 201,
    });
  }
}

async function attachments(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.fileId || !ctx.ids.taskId) {
    client.skip(
      'attachments',
      '/attachments',
      'POST',
      'an available file and a task are both required',
    );
    return;
  }

  const attachment = await client.call({
    name: 'user attaches the uploaded file to the task',
    method: 'POST',
    path: '/attachments',
    actor: 'user',
    body: {
      entityType: 'task',
      entityId: ctx.ids.taskId,
      fileId: ctx.ids.fileId,
      label: 'Ingest worker notes',
      kind: 'document',
      sortOrder: 0,
    },
    expect: 201,
  });
  if (attachment.ok) ctx.ids.attachmentId = attachment.body.id;

  await client.call({
    name: 'an attachment cannot reference a file that does not exist',
    method: 'POST',
    path: '/attachments',
    actor: 'user',
    body: {
      entityType: 'task',
      entityId: ctx.ids.taskId,
      fileId: '00000000-0000-4000-8000-000000000000',
    },
    expect: [400, 403, 404, 409, 422],
  });

  await client.call({
    name: 'an unknown attachment kind is rejected',
    method: 'POST',
    path: '/attachments',
    actor: 'user',
    body: {
      entityType: 'task',
      entityId: ctx.ids.taskId,
      fileId: ctx.ids.fileId,
      kind: 'hieroglyph',
    },
    expect: 400,
  });

  await client.call({
    name: 'listing attachments requires naming the parent entity',
    method: 'GET',
    path: '/attachments',
    actor: 'user',
    expect: 400,
  });

  await client.call({
    name: 'user lists the task’s attachments',
    method: 'GET',
    path: '/attachments',
    actor: 'user',
    query: { entityType: 'task', entityId: ctx.ids.taskId, page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.some((a) => a.id === ctx.ids.attachmentId)
        ? undefined
        : 'the attachment just created is not listed';
    },
  });

  if (ctx.ids.knowledgeId) {
    const second = await client.call({
      name: 'the same file can be attached to a knowledge record',
      method: 'POST',
      path: '/attachments',
      actor: 'user',
      body: {
        entityType: 'knowledge',
        entityId: ctx.ids.knowledgeId,
        fileId: ctx.ids.fileId,
        label: 'Source notes',
      },
      expect: 201,
    });

    if (second.ok) {
      await client.call({
        name: 'user detaches it again',
        method: 'DELETE',
        path: '/attachments/{id}',
        params: { id: second.body.id },
        actor: 'user',
        expect: 204,
      });
    }
  }
}

async function activity(ctx: Ctx): Promise<void> {
  const { client } = ctx;

  await client.call({
    name: 'user reads its own activity feed',
    method: 'GET',
    path: '/activity/me',
    actor: 'user',
    query: { page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.length > 0
        ? undefined
        : 'the mock user has created a dozen records and its feed is empty';
    },
  });

  await client.call({
    name: 'the personal feed can be scoped to one entity',
    method: 'GET',
    path: '/activity/me',
    actor: 'user',
    query: { entityType: 'task', entityId: ctx.ids.taskId, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      const foreign = rows.find((a) => a.entityType !== 'task');
      return foreign
        ? `entity filter leaked a ${foreign.entityType} entry`
        : undefined;
    },
  });

  await client.call({
    name: 'an unknown activity entity type is rejected',
    method: 'GET',
    path: '/activity/me',
    actor: 'user',
    query: { entityType: 'sacrifice' },
    expect: 400,
  });

  await client.call({
    name: 'a standard user cannot read the global activity feed',
    method: 'GET',
    path: '/activity',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin reads the global activity feed',
    method: 'GET',
    path: '/activity',
    actor: 'admin',
    query: { page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.length > 0
        ? undefined
        : 'the global feed is empty after a full run';
    },
  });

  await client.call({
    name: 'the global feed can be filtered by actor',
    method: 'GET',
    path: '/activity',
    actor: 'admin',
    query: { actorUserId: ctx.ids.mockUserId, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      const foreign = rows.find(
        (a) => a.actorUserId && a.actorUserId !== ctx.ids.mockUserId,
      );
      return foreign
        ? 'actor filter leaked another user’s activity'
        : undefined;
    },
  });

  await client.call({
    name: 'the global feed can be filtered by project',
    method: 'GET',
    path: '/activity',
    actor: 'admin',
    query: { projectId: ctx.ids.projectId, limit: 50 },
    expect: 200,
  });
}
