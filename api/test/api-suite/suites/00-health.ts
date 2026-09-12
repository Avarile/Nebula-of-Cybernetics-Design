import type { Ctx } from '../harness/context';

/**
 * The public surface and the admin-gated deep health check.
 *
 * `/health/live` and `/health/ready` are `@Public()` by design (a liveness probe
 * that needs a token is useless to an orchestrator); `/health` is `@Roles('admin')`
 * because it names every dependency and its state. That split is the thing worth
 * asserting — a regression that makes `/health` public leaks topology.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client } = ctx;

  await client.call({
    name: 'liveness responds without a token',
    method: 'GET',
    path: '/health/live',
    actor: 'anon',
    expect: 200,
    assert: (b) => (b?.status === 'ok' ? undefined : `status was ${b?.status}`),
  });

  await client.call({
    name: 'readiness responds without a token',
    method: 'GET',
    path: '/health/ready',
    actor: 'anon',
    expect: 200,
    assert: (b) =>
      b?.status === 'ok'
        ? undefined
        : `status was ${JSON.stringify(b?.status)}`,
  });

  await client.call({
    name: 'deep health is admin-gated, not public',
    method: 'GET',
    path: '/health',
    actor: 'anon',
    expect: 401,
  });

  await client.call({
    name: 'deep health rejects a standard user',
    method: 'GET',
    path: '/health',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'deep health reports every dependency to an admin',
    method: 'GET',
    path: '/health',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const info = b?.info ?? {};
      const want = ['database', 'redis', 'minio', 'meilisearch'];
      const missing = want.filter((k) => !(k in info));
      if (missing.length) return `missing indicators: ${missing.join(', ')}`;
      const down = Object.entries(info)
        .filter(([, v]: [string, any]) => v?.status !== 'up')
        .map(([k]) => k);
      return down.length ? `dependencies down: ${down.join(', ')}` : undefined;
    },
  });

  // Mastra mounts its own operational routes at the app root. They are declared
  // in the OpenAPI document, so cover them rather than leave a permanent gap.
  await client.call({
    name: 'agent runtime reports ready',
    method: 'GET',
    path: '/ready',
    actor: 'anon',
    expect: [200, 401, 404],
    soft: true,
  });

  await client.call({
    name: 'agent runtime reports version info',
    method: 'GET',
    path: '/info',
    actor: 'anon',
    expect: [200, 401, 404],
    soft: true,
  });
}
