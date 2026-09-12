import type { Ctx } from '../harness/context';

/**
 * Removes the run's operator-level fixtures and covers the remaining DELETE
 * operations while doing it.
 *
 * What is deliberately *not* removed: the mock user and its work — the contact,
 * company, knowledge record, project, tasks, time entries, invoice and
 * comments. That dataset is the point of the exercise, and leaving it behind is
 * what makes the run useful to look at afterwards. Pass `--cleanup` to remove
 * that too when a run is only meant to answer "is the API healthy".
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  const full = process.argv.includes('--cleanup');

  // --------------------------------------- operator fixtures, always removed

  if (ctx.ids.settingKey) {
    await client.call({
      name: 'admin removes the probe setting',
      method: 'DELETE',
      path: '/system/settings/{key}',
      params: { key: ctx.ids.settingKey },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the removed setting is gone',
      method: 'GET',
      path: '/system/settings/{key}',
      params: { key: ctx.ids.settingKey },
      actor: 'admin',
      expect: 404,
    });
  }

  if (ctx.ids.featureFlagKey) {
    await client.call({
      name: 'admin removes the probe feature flag',
      method: 'DELETE',
      path: '/system/feature-flags/{key}',
      params: { key: ctx.ids.featureFlagKey },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the removed flag is gone',
      method: 'GET',
      path: '/system/feature-flags/{key}',
      params: { key: ctx.ids.featureFlagKey },
      actor: 'admin',
      expect: 404,
    });
  }

  if (ctx.ids.smtpId) {
    await client.call({
      name: 'admin removes the probe SMTP config',
      method: 'DELETE',
      path: '/system/smtp/{id}',
      params: { id: ctx.ids.smtpId },
      actor: 'admin',
      expect: 204,
    });
  }

  if (ctx.ids.imapId) {
    await client.call({
      name: 'admin removes the probe IMAP config',
      method: 'DELETE',
      path: '/system/imap/{id}',
      params: { id: ctx.ids.imapId },
      actor: 'admin',
      expect: 204,
    });
  }

  if (ctx.ids.integrationId) {
    await client.call({
      name: 'admin removes the probe integration credential',
      method: 'DELETE',
      path: '/system/integrations/{id}',
      params: { id: ctx.ids.integrationId },
      actor: 'admin',
      expect: 204,
    });
  }

  if (ctx.ids.serviceCredentialId) {
    await client.call({
      name: 'admin revokes the service credential',
      method: 'DELETE',
      path: '/service-credentials/{id}',
      params: { id: ctx.ids.serviceCredentialId },
      actor: 'admin',
      expect: 204,
    });

    if (ctx.ids.serviceApiKey) {
      await client.call({
        name: 'the revoked key can no longer be exchanged for a token',
        method: 'POST',
        path: '/auth/service-token',
        actor: 'anon',
        body: { apiKey: ctx.ids.serviceApiKey },
        expect: [401, 403],
      });
    }
  }

  if (ctx.ids.collectionName) {
    await client.call({
      name: 'admin drops the search collection',
      method: 'DELETE',
      path: '/search/collections/{name}',
      params: { name: ctx.ids.collectionName },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the dropped collection is gone',
      method: 'GET',
      path: '/search/collections/{name}',
      params: { name: ctx.ids.collectionName },
      actor: 'admin',
      expect: 404,
    });
  }

  if (ctx.ids.secondUserId) {
    await client.call({
      name: 'admin removes the collaborator account',
      method: 'DELETE',
      path: '/users/{id}',
      params: { id: ctx.ids.secondUserId },
      actor: 'admin',
      expect: 204,
    });
  }

  // ------------------------------------------- the mock dataset, only on demand

  if (!full) {
    client.skip(
      'remove the mock user and its data',
      '/users/{id}',
      'DELETE',
      'kept on purpose — pass --cleanup to remove the mock dataset',
    );
    console.log(
      `\n  Mock dataset left in place for inspection:\n` +
        `    user        ${client.principal('user').email}\n` +
        `    contact     ${ctx.ids.contactId ?? '—'}\n` +
        `    company     ${ctx.ids.companyId ?? '—'}\n` +
        `    knowledge   ${ctx.ids.knowledgeId ?? '—'}\n` +
        `    project     ${ctx.ids.projectId ?? '—'}\n` +
        `    task        ${ctx.ids.taskId ?? '—'}\n` +
        `    invoice     ${ctx.ids.invoiceId ?? '—'}\n` +
        `    file        ${ctx.ids.fileId ?? '—'}\n` +
        `  Re-run with --cleanup to delete all of it.`,
    );
    return;
  }

  const removals: Array<[string, string, Record<string, string>]> = [];
  if (ctx.ids.taskId)
    removals.push(['the task', '/tasks/{id}', { id: ctx.ids.taskId }]);
  if (ctx.ids.blockerTaskId) {
    removals.push([
      'the predecessor task',
      '/tasks/{id}',
      { id: ctx.ids.blockerTaskId },
    ]);
  }
  if (ctx.ids.projectId) {
    removals.push(['the project', '/projects/{id}', { id: ctx.ids.projectId }]);
  }
  if (ctx.ids.knowledgeId) {
    removals.push([
      'the knowledge record',
      '/knowledge/{id}',
      { id: ctx.ids.knowledgeId },
    ]);
  }
  if (ctx.ids.contactId) {
    removals.push([
      'the primary contact',
      '/contacts/{id}',
      { id: ctx.ids.contactId },
    ]);
  }
  if (ctx.ids.contactTwoId) {
    removals.push([
      'the secondary contact',
      '/contacts/{id}',
      { id: ctx.ids.contactTwoId },
    ]);
  }
  if (ctx.ids.companyId) {
    removals.push([
      'the company',
      '/companies/{id}',
      { id: ctx.ids.companyId },
    ]);
  }
  if (ctx.ids.fileId)
    removals.push(['the uploaded file', '/files/{id}', { id: ctx.ids.fileId }]);

  for (const [label, path, params] of removals) {
    await client.call({
      name: `admin removes ${label}`,
      method: 'DELETE',
      path,
      params,
      actor: 'admin',
      expect: [204, 404, 409],
    });
  }

  for (const [label, id] of [
    ['contact tag', ctx.ids.tagContactId],
    ['knowledge tag', ctx.ids.tagKnowledgeId],
    ['project tag', ctx.ids.tagProjectId],
    ['task tag', ctx.ids.tagTaskId],
  ] as const) {
    if (!id) continue;
    await client.call({
      name: `admin removes the ${label}`,
      method: 'DELETE',
      path: '/tags/{id}',
      params: { id },
      actor: 'admin',
      expect: [204, 404, 409],
    });
  }

  for (const [label, kind, id] of [
    ['contact type', 'contact-vocabulary/types', ctx.ids.contactTypeId],
    [
      'contact category',
      'contact-vocabulary/categories',
      ctx.ids.contactCategoryId,
    ],
    ['knowledge type', 'knowledge-vocabulary/types', ctx.ids.knowledgeTypeId],
    [
      'knowledge category',
      'knowledge-vocabulary/categories',
      ctx.ids.knowledgeCategoryId,
    ],
  ] as const) {
    if (!id) continue;
    await client.call({
      name: `admin removes the ${label}`,
      method: 'DELETE',
      path: `/${kind}/{id}`,
      params: { id },
      actor: 'admin',
      expect: [204, 404, 409],
    });
  }

  if (ctx.ids.mockUserId) {
    await client.call({
      name: 'admin removes the mock user',
      method: 'DELETE',
      path: '/users/{id}',
      params: { id: ctx.ids.mockUserId },
      actor: 'admin',
      expect: 204,
    });
  }
}
