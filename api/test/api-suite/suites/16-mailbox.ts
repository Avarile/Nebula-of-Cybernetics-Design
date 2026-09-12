import type { Ctx } from '../harness/context';

/**
 * Inbound mail.
 *
 * The whole controller is `@Roles('admin')` — mailbox contents are other
 * people's correspondence — so the access assertions are the load-bearing part.
 * `POST /mailbox/sync` genuinely dials IMAP, and this run configured a
 * deliberately unreachable host, so that one is soft: what is being checked is
 * that an unreachable mail server produces a handled response rather than an
 * unhandled rejection.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client } = ctx;

  // `MAILBOX_DEFAULT_ACCOUNT_ID` is unset in this environment, so every listing
  // has to name its account. The IMAP config created by the system suite is
  // that account; without it, assert the unresolved-account contract instead.
  const accountId = ctx.ids.imapId;

  if (!accountId) {
    await client.call({
      name: 'listing without an account or a configured default is refused',
      method: 'GET',
      path: '/mailbox/messages',
      actor: 'admin',
      expect: 400,
      assert: (b) =>
        b?.error?.code === 'MAILBOX_ACCOUNT_UNRESOLVED'
          ? undefined
          : `error code was ${b?.error?.code}`,
    });
  }

  await client.call({
    name: 'a standard user cannot read the mailbox',
    method: 'GET',
    path: '/mailbox/messages',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'reading the mailbox requires authentication',
    method: 'GET',
    path: '/mailbox/messages',
    actor: 'anon',
    expect: 401,
  });

  const listed = await client.call({
    name: 'admin lists mailbox messages',
    method: 'GET',
    path: '/mailbox/messages',
    actor: 'admin',
    query: { accountId, mailbox: 'INBOX', page: 1, limit: 50 },
    expect: accountId ? 200 : 400,
    // NOTE: this endpoint paginates as { items, total, page, limit }. Most of
    // the API uses { data, ... } and `/finance/budgets` uses { rows, ... }, so
    // a generic client has to special-case all three.
    assert: (b) =>
      !accountId || Array.isArray(b?.items)
        ? undefined
        : 'expected a paginated envelope',
  });

  await client.call({
    name: 'unseen-only filtering is accepted',
    method: 'GET',
    path: '/mailbox/messages',
    actor: 'admin',
    query: { accountId, unseenOnly: true, limit: 20 },
    expect: accountId ? 200 : 400,
  });

  await client.call({
    name: 'a non-uuid account id is rejected',
    method: 'GET',
    path: '/mailbox/messages',
    actor: 'admin',
    query: { accountId: 'not-a-uuid' },
    expect: 400,
  });

  const messages: any[] = listed.body?.items ?? listed.body?.data ?? [];
  const message = messages[0];

  if (message?.id) {
    await client.call({
      name: 'admin reads a single message',
      method: 'GET',
      path: '/mailbox/messages/{id}',
      params: { id: message.id },
      actor: 'admin',
      expect: 200,
    });

    await client.call({
      name: 'admin marks a message seen',
      method: 'PATCH',
      path: '/mailbox/messages/{id}/seen',
      params: { id: message.id },
      actor: 'admin',
      body: { seen: true },
      expect: 204,
    });

    const attachmentId = message.attachments?.[0]?.id;
    if (attachmentId) {
      await client.call({
        name: 'admin downloads a message attachment',
        method: 'GET',
        path: '/mailbox/messages/{id}/attachments/{attId}/download',
        params: { id: message.id, attId: attachmentId },
        actor: 'admin',
        expect: [200, 302],
      });
    } else {
      client.skip(
        'admin downloads a message attachment',
        '/mailbox/messages/{id}/attachments/{attId}/download',
        'GET',
        'no ingested message carries an attachment',
      );
    }
  } else {
    // No mail has been ingested into this environment. Rather than leave three
    // operations permanently uncovered, drive them with a well-formed id and
    // assert the 404 — that still exercises routing, the guard chain, the uuid
    // pipe and the service's not-found path.
    const absent = '00000000-0000-4000-8000-000000000000';

    await client.call({
      name: 'an unknown message id is a 404',
      method: 'GET',
      path: '/mailbox/messages/{id}',
      params: { id: absent },
      actor: 'admin',
      expect: 404,
    });

    await client.call({
      name: 'marking an unknown message seen is a 404',
      method: 'PATCH',
      path: '/mailbox/messages/{id}/seen',
      params: { id: absent },
      actor: 'admin',
      body: { seen: true },
      expect: 404,
    });

    await client.call({
      name: 'downloading from an unknown message is a 404',
      method: 'GET',
      path: '/mailbox/messages/{id}/attachments/{attId}/download',
      params: { id: absent, attId: absent },
      actor: 'admin',
      expect: 404,
    });
  }

  await client.call({
    name: 'the seen flag must be a boolean',
    method: 'PATCH',
    path: '/mailbox/messages/{id}/seen',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'admin',
    body: { seen: 'yes' },
    expect: 400,
  });

  await client.call({
    name: 'a standard user cannot trigger a mailbox sync',
    method: 'POST',
    path: '/mailbox/sync',
    actor: 'user',
    body: { mailbox: 'INBOX' },
    expect: 403,
  });

  await client.call({
    name: 'admin queues a mailbox sync',
    method: 'POST',
    path: '/mailbox/sync',
    actor: 'admin',
    body: { accountId, mailbox: 'INBOX' },
    expect: [202, 200, 400, 404, 409, 422, 502, 503],
    soft: true,
  });
}
