import type { Ctx } from '../harness/context';

/**
 * The Mastra agent surface: conversations, human-in-the-loop approvals, and
 * scheduled prompts.
 *
 * `POST /agent/chat` and `/agent/chat/stream` call out to the AI gateway, which
 * this suite does not control and which costs money per call. They are marked
 * soft so an unconfigured or rate-limited gateway does not turn a run red, and
 * the streaming variant is opt-in via `API_SUITE_AGENT_CHAT=1`. Everything that
 * does not need the model is checked normally.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const chatEnabled = process.env.API_SUITE_AGENT_CHAT !== '0';

  // ----------------------------------------------------------- conversations

  await client.call({
    name: 'user lists its agent conversations',
    method: 'GET',
    path: '/agent/conversations',
    actor: 'user',
    query: { page: 1, limit: 20 },
    expect: 200,
    assert: (b) =>
      Array.isArray(b?.data) ? undefined : 'expected a paginated envelope',
  });

  await client.call({
    name: 'conversations require authentication',
    method: 'GET',
    path: '/agent/conversations',
    actor: 'anon',
    expect: 401,
  });

  await client.call({
    name: 'an agent token cannot drive the chat surface',
    method: 'GET',
    path: '/agent/conversations',
    actor: 'agent',
    expect: 403,
  });

  // ------------------------------------------------------------------- chat

  if (chatEnabled) {
    const chat = await client.call({
      name: 'user sends a message to the agent',
      method: 'POST',
      path: '/agent/chat',
      actor: 'user',
      body: { message: 'Reply with the single word: pong' },
      // A working gateway answers 200/201. An unreachable or unconfigured one
      // should surface as a mapped upstream failure (502/503), not a bare 500 —
      // a 500 here means the gateway error is escaping unmapped.
      expect: [200, 201, 502, 503, 504],
      soft: true,
    });

    if (chat.ok && chat.body?.conversationId) {
      ctx.ids.conversationId = chat.body.conversationId;

      await client.call({
        name: 'the conversation carries the exchange',
        method: 'GET',
        path: '/agent/conversations/{id}/messages',
        params: { id: chat.body.conversationId },
        actor: 'user',
        expect: 200,
        assert: (b) => {
          const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
          return rows.length > 0
            ? undefined
            : 'the conversation has no messages';
        },
      });
    } else {
      await client.call({
        name: 'an unknown conversation id is a 404',
        method: 'GET',
        path: '/agent/conversations/{id}/messages',
        params: { id: '00000000-0000-4000-8000-000000000000' },
        actor: 'user',
        expect: [403, 404],
      });
    }

    await client.call({
      name: 'an empty chat message is rejected before the gateway is called',
      method: 'POST',
      path: '/agent/chat',
      actor: 'user',
      body: { message: '' },
      expect: 400,
    });

    await client.call({
      name: 'the streaming endpoint accepts a well-formed request',
      method: 'POST',
      path: '/agent/chat/stream',
      actor: 'user',
      body: { message: 'Reply with the single word: pong' },
      expect: [200, 201, 502, 503, 504],
      soft: true,
    });

    await client.call({
      name: 'the streaming endpoint rejects a malformed resume block',
      method: 'POST',
      path: '/agent/chat/stream',
      actor: 'user',
      body: { resume: { approvalId: 'not-a-uuid', approved: true } },
      expect: 400,
    });
  } else {
    for (const path of ['/agent/chat', '/agent/chat/stream']) {
      client.skip(
        `agent chat via ${path}`,
        path,
        'POST',
        'API_SUITE_AGENT_CHAT=0 — the AI gateway is not exercised',
      );
    }
    client.skip(
      'conversation messages',
      '/agent/conversations/{id}/messages',
      'GET',
      'no conversation exists without a chat call',
    );
  }

  // --------------------------------------------------------------- approvals

  await client.call({
    name: 'user lists pending approvals',
    method: 'GET',
    path: '/agent/approvals',
    actor: 'user',
    expect: 200,
    assert: (b) =>
      Array.isArray(b) || Array.isArray(b?.data)
        ? undefined
        : 'expected a list',
  });

  await client.call({
    name: 'resolving an unknown approval is a 404',
    method: 'POST',
    path: '/agent/approvals/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'user',
    body: { approved: true, note: 'Probe' },
    expect: [400, 403, 404, 410],
  });

  // --------------------------------------------------------------- schedules

  await client.call({
    name: 'a standard user cannot create an agent schedule',
    method: 'POST',
    path: '/agent/schedules',
    actor: 'user',
    body: {
      name: 'Rogue schedule',
      cron: '0 9 * * *',
      promptTemplate: 'Do things',
    },
    expect: 403,
  });

  const schedule = await client.call({
    name: 'admin creates a scheduled prompt',
    method: 'POST',
    path: '/agent/schedules',
    actor: 'admin',
    body: {
      name: `API suite digest ${stamp}`,
      description: 'Fixture schedule created by the live API suite.',
      cron: '0 9 * * 1',
      timezone: 'Australia/Sydney',
      agentId: 'orchestrator',
      promptTemplate:
        'Summarise last week’s activity for the delivery project.',
      params: { projectId: ctx.ids.projectId ?? null },
      deliveryChannel: 'conversation',
      targetUserId: ctx.ids.mockUserId,
      enabled: true,
    },
    expect: 201,
  });
  if (schedule.ok) ctx.ids.scheduleId = schedule.body.id;

  await client.call({
    name: 'a malformed cron expression is rejected',
    method: 'POST',
    path: '/agent/schedules',
    actor: 'admin',
    body: {
      name: 'Bad cron',
      cron: 'every so often',
      promptTemplate: 'Do things',
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'an unknown agent id is rejected',
    method: 'POST',
    path: '/agent/schedules',
    actor: 'admin',
    body: {
      name: 'Bad agent',
      cron: '0 9 * * *',
      promptTemplate: 'Do things',
      agentId: 'nonexistent',
    },
    expect: 400,
  });

  await client.call({
    name: 'a schedule needs a prompt template',
    method: 'POST',
    path: '/agent/schedules',
    actor: 'admin',
    body: { name: 'No prompt', cron: '0 9 * * *' },
    expect: 400,
  });

  await mastraProxy(ctx);

  if (ctx.ids.scheduleId) {
    await client.call({
      name: 'a standard user cannot delete an agent schedule',
      method: 'DELETE',
      path: '/agent/schedules/{id}',
      params: { id: ctx.ids.scheduleId },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin deletes the schedule',
      method: 'DELETE',
      path: '/agent/schedules/{id}',
      params: { id: ctx.ids.scheduleId },
      actor: 'admin',
      expect: [200, 204],
    });
    ctx.ids.scheduleId = undefined;
  }
}

/**
 * The Mastra runtime's own routes, mounted at the application root behind a
 * `/{path}` wildcard and served by Mastra's router rather than Nest's.
 *
 * Two things are worth asserting about a wildcard like this: that it still sits
 * behind the JWT guard (a proxy that forgets authentication is a hole straight
 * through every other guard in the app), and what it answers for a path it does
 * not recognise.
 */
async function mastraProxy(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const unknown = `apisuite-probe-${stamp}`;

  await client.call({
    name: 'the agent-runtime wildcard is not reachable anonymously',
    method: 'GET',
    path: '/{path}',
    params: { path: unknown },
    actor: 'anon',
    expect: 401,
  });

  await client.call({
    name: 'admin reaches the agent runtime through the wildcard',
    method: 'GET',
    path: '/{path}',
    params: { path: 'api/agent-core/agents' },
    actor: 'admin',
    expect: [200, 404],
  });

  // NOTE: routes served by the Mastra router answer with Mastra's own error
  // shape ({ error, code, requestId, timestamp }) rather than the application's
  // ErrorEnvelope ({ error: { code, message, statusCode, ... } }). A client
  // parsing errors generically has to handle both.
  const unrecognised = await client.call({
    name: 'an unrecognised wildcard path is a 404',
    method: 'GET',
    path: '/{path}',
    params: { path: unknown },
    actor: 'admin',
    expect: 404,
  });

  client.assert(
    'the agent runtime answers errors in its own envelope, not the app’s',
    'GET',
    '/{path}',
    unrecognised.body?.error !== undefined &&
      typeof unrecognised.body?.error === 'string'
      ? undefined
      : `envelope was ${JSON.stringify(unrecognised.body).slice(0, 160)}`,
  );

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    await client.call({
      name: `an unrecognised ${method} through the wildcard is a 404`,
      method,
      path: '/{path}',
      params: { path: unknown },
      actor: 'admin',
      body: method === 'DELETE' ? undefined : {},
      expect: [400, 404, 405],
    });
  }
}
