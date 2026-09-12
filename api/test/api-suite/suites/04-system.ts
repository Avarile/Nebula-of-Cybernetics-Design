import { isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * The operator surface: settings, feature flags, retention, the event log, the
 * audit trail, and the three credential stores (SMTP, IMAP, generic integrations).
 *
 * Every route here is `@Roles('admin')`, so each group opens with the mock user
 * being turned away — an operator surface that leaks to a standard account is
 * worse than one that is merely broken.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  const settingKey = `apisuite.setting.${stamp}`;
  const flagKey = `apisuite.flag.${stamp}`;
  ctx.ids.settingKey = settingKey;
  ctx.ids.featureFlagKey = flagKey;

  // ------------------------------------------------------------------ settings

  await client.call({
    name: 'a standard user cannot read system settings',
    method: 'GET',
    path: '/system/settings',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin creates a typed setting',
    method: 'PUT',
    path: '/system/settings/{key}',
    params: { key: settingKey },
    actor: 'admin',
    body: {
      value: 'initial',
      type: 'string',
      category: 'api-suite',
      description: 'Written by the live API suite.',
    },
    expect: [200, 201],
  });

  const read = await client.call({
    name: 'admin reads the setting back',
    method: 'GET',
    path: '/system/settings/{key}',
    params: { key: settingKey },
    actor: 'admin',
    expect: 200,
    assert: (b) =>
      b?.value === 'initial' ? undefined : `value was ${b?.value}`,
  });

  const version = read.body?.version;

  await client.call({
    name: 'setting values are checked against the declared type',
    method: 'PUT',
    path: '/system/settings/{key}',
    params: { key: `${settingKey}.typed` },
    actor: 'admin',
    body: { value: 'not-a-number', type: 'number' },
    expect: [400, 422],
  });

  if (typeof version === 'number') {
    await client.call({
      name: 'a stale expectedVersion is rejected',
      method: 'PUT',
      path: '/system/settings/{key}',
      params: { key: settingKey },
      actor: 'admin',
      body: { value: 'stale', type: 'string', expectedVersion: version + 99 },
      expect: [409, 412, 400],
    });

    await client.call({
      name: 'the current expectedVersion is accepted',
      method: 'PUT',
      path: '/system/settings/{key}',
      params: { key: settingKey },
      actor: 'admin',
      body: {
        value: 'updated',
        type: 'string',
        category: 'api-suite',
        expectedVersion: version,
      },
      expect: [200, 201],
    });
  }

  await client.call({
    name: 'admin filters settings by category',
    method: 'GET',
    path: '/system/settings',
    actor: 'admin',
    query: { category: 'api-suite', page: 1, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      if (!rows.some((r) => r.key === settingKey))
        return 'the new setting is not in its category';
      const foreign = rows.find((r) => r.category !== 'api-suite');
      return foreign ? `category filter leaked ${foreign.key}` : undefined;
    },
  });

  await client.call({
    name: 'an unknown setting key is a 404',
    method: 'GET',
    path: '/system/settings/{key}',
    params: { key: `no.such.setting.${stamp}` },
    actor: 'admin',
    expect: 404,
  });

  // -------------------------------------------------------------- feature flags

  await client.call({
    name: 'a standard user cannot read feature flags',
    method: 'GET',
    path: '/system/feature-flags',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin lists the seeded module flags',
    method: 'GET',
    path: '/system/feature-flags',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((r) => r.key?.startsWith('module.'))
        ? undefined
        : 'no module.* flags are seeded';
    },
  });

  await client.call({
    name: 'admin creates a flag with a rollout spec',
    method: 'PUT',
    path: '/system/feature-flags/{key}',
    params: { key: flagKey },
    actor: 'admin',
    body: {
      description: 'API suite probe flag',
      enabled: true,
      rollout: { roles: ['user'], percentage: 50 },
      expiresAt: isoDateTime(7),
    },
    expect: [200, 201],
  });

  await client.call({
    name: 'admin reads the flag back with its rollout intact',
    method: 'GET',
    path: '/system/feature-flags/{key}',
    params: { key: flagKey },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      if (b?.enabled !== true) return `enabled was ${b?.enabled}`;
      if (b?.rollout?.percentage !== 50)
        return `rollout lost: ${JSON.stringify(b?.rollout)}`;
      return undefined;
    },
  });

  await client.call({
    name: 'a rollout percentage above 100 is rejected',
    method: 'PUT',
    path: '/system/feature-flags/{key}',
    params: { key: `${flagKey}.bad` },
    actor: 'admin',
    body: { enabled: true, rollout: { percentage: 150 } },
    expect: [400, 422],
  });

  // ----------------------------------------------------------------- retention

  await client.call({
    name: 'a standard user cannot read retention policy',
    method: 'GET',
    path: '/system/retention',
    actor: 'user',
    expect: 403,
  });

  const policies = await client.call({
    name: 'admin lists retention policies',
    method: 'GET',
    path: '/system/retention',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0 ? undefined : 'no retention policies are seeded';
    },
  });

  const policyRows: any[] = Array.isArray(policies.body) ? policies.body : [];
  const target =
    policyRows.find((p) => p.entityType === 'activity_log') ?? policyRows[0];

  if (target) {
    ctx.facts.retentionEntityType = target.entityType;
    const original = target.retentionDays;

    await client.call({
      name: 'admin adjusts a retention window',
      method: 'PATCH',
      path: '/system/retention/{entityType}',
      params: { entityType: target.entityType },
      actor: 'admin',
      body: { retentionDays: 400, enabled: true },
      expect: 200,
      assert: (b) =>
        b?.retentionDays === 400
          ? undefined
          : `retentionDays was ${b?.retentionDays}`,
    });

    await client.call({
      name: 'a negative retention window is rejected',
      method: 'PATCH',
      path: '/system/retention/{entityType}',
      params: { entityType: target.entityType },
      actor: 'admin',
      body: { retentionDays: -5 },
      expect: [400, 422],
    });

    // FINDING: `entityType` is read straight off the path with no validation
    // and handed to a Postgres enum column, so an unknown value raises
    // SQLSTATE 22P02 and escapes as a 500 — the service's own
    // RETENTION_POLICY_NOT_FOUND branch is never reached. Asserted as it
    // ought to behave, so a fix turns this green.
    await client.call({
      name: 'an unknown retention entity is rejected',
      method: 'PATCH',
      path: '/system/retention/{entityType}',
      params: { entityType: 'not_a_real_entity' },
      actor: 'admin',
      body: { retentionDays: 30 },
      expect: [400, 404, 422],
    });

    await client.call({
      name: 'the retention window is restored',
      method: 'PATCH',
      path: '/system/retention/{entityType}',
      params: { entityType: target.entityType },
      actor: 'admin',
      body: { retentionDays: original },
      expect: 200,
    });
  }

  await client.call({
    name: 'admin runs the retention sweep on demand',
    method: 'POST',
    path: '/system/retention/run',
    actor: 'admin',
    expect: [200, 201, 202],
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.results ?? b?.data ?? []);
      return Array.isArray(rows)
        ? undefined
        : `expected a per-policy result set, got ${typeof b}`;
    },
  });

  await client.call({
    name: 'a standard user cannot run the retention sweep',
    method: 'POST',
    path: '/system/retention/run',
    actor: 'user',
    expect: 403,
  });

  // ------------------------------------------------------- events + audit trail

  await client.call({
    name: 'the retention sweep left an entry in the event log',
    method: 'GET',
    path: '/system/events',
    actor: 'admin',
    query: { page: 1, limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((r) => String(r.eventKey ?? '').startsWith('retention.'))
        ? undefined
        : 'no retention event was recorded';
    },
  });

  await client.call({
    name: 'events can be filtered by severity',
    method: 'GET',
    path: '/system/events',
    actor: 'admin',
    query: { severity: 'error', limit: 5 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const wrong = rows.find((r) => r.severity !== 'error');
      return wrong ? `severity filter leaked ${wrong.severity}` : undefined;
    },
  });

  await client.call({
    name: 'an invalid severity is rejected',
    method: 'GET',
    path: '/system/events',
    actor: 'admin',
    query: { severity: 'catastrophic' },
    expect: 400,
  });

  await client.call({
    name: 'a standard user cannot read the event log',
    method: 'GET',
    path: '/system/events',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin reads the audit trail',
    method: 'GET',
    path: '/system/audit',
    actor: 'admin',
    query: { page: 1, limit: 10 },
    expect: 200,
    assert: (b) =>
      Array.isArray(b?.data) ? undefined : 'expected a paginated envelope',
  });

  await client.call({
    name: 'a standard user cannot read the audit trail',
    method: 'GET',
    path: '/system/audit',
    actor: 'user',
    expect: 403,
  });

  await runCredentialStores(ctx);
}

/**
 * SMTP, IMAP and integration credentials share a shape: create, read back with
 * the secret withheld, patch, activate, test, delete. The `test` endpoints
 * genuinely dial the configured host, so they are soft — a sandbox with no mail
 * server should not turn the whole run red.
 */
async function runCredentialStores(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  // ---------------------------------------------------------------------- SMTP

  await client.call({
    name: 'a standard user cannot list SMTP configs',
    method: 'GET',
    path: '/system/smtp',
    actor: 'user',
    expect: 403,
  });

  const smtp = await client.call({
    name: 'admin creates an SMTP config',
    method: 'POST',
    path: '/system/smtp',
    actor: 'admin',
    body: {
      name: `api-suite-smtp-${stamp}`,
      host: 'smtp.invalid.test',
      port: 587,
      username: 'suite',
      secret: 'suite-smtp-secret',
      secure: false,
      fromAddress: `noreply.${stamp}@cybernetics.test`,
      fromName: 'API Suite',
    },
    expect: 201,
    assert: (b) =>
      b?.secret || b?.password ? 'creation echoed the secret back' : undefined,
  });

  if (smtp.ok) {
    ctx.ids.smtpId = smtp.body.id;

    await client.call({
      name: 'admin reads the SMTP config without the secret',
      method: 'GET',
      path: '/system/smtp/{id}',
      params: { id: smtp.body.id },
      actor: 'admin',
      expect: 200,
      assert: (b) =>
        b?.secret ? 'the stored secret was returned in cleartext' : undefined,
    });

    await client.call({
      name: 'admin lists SMTP configs',
      method: 'GET',
      path: '/system/smtp',
      actor: 'admin',
      query: { page: 1, limit: 20 },
      expect: 200,
    });

    await client.call({
      name: 'admin renames the SMTP config',
      method: 'PATCH',
      path: '/system/smtp/{id}',
      params: { id: smtp.body.id },
      actor: 'admin',
      body: { name: `api-suite-smtp-${stamp}-renamed`, port: 2525 },
      expect: 200,
    });

    await client.call({
      name: 'an out-of-range SMTP port is rejected',
      method: 'PATCH',
      path: '/system/smtp/{id}',
      params: { id: smtp.body.id },
      actor: 'admin',
      body: { port: 99_999 },
      expect: [400, 422],
    });

    await client.call({
      name: 'admin activates the SMTP config',
      method: 'POST',
      path: '/system/smtp/{id}/activate',
      params: { id: smtp.body.id },
      actor: 'admin',
      expect: [200, 201, 204],
    });

    await client.call({
      name: 'testing an unreachable SMTP host reports failure rather than crashing',
      method: 'POST',
      path: '/system/smtp/{id}/test',
      params: { id: smtp.body.id },
      actor: 'admin',
      expect: [200, 201, 400, 422, 502, 503, 504],
      soft: true,
    });
  }

  // ---------------------------------------------------------------------- IMAP

  const imap = await client.call({
    name: 'admin creates an IMAP config',
    method: 'POST',
    path: '/system/imap',
    actor: 'admin',
    body: {
      name: `api-suite-imap-${stamp}`,
      host: 'imap.invalid.test',
      port: 993,
      username: 'suite',
      secret: 'suite-imap-secret',
      secure: true,
    },
    expect: 201,
  });

  if (imap.ok) {
    ctx.ids.imapId = imap.body.id;

    await client.call({
      name: 'admin reads the IMAP config without the secret',
      method: 'GET',
      path: '/system/imap/{id}',
      params: { id: imap.body.id },
      actor: 'admin',
      expect: 200,
      assert: (b) =>
        b?.secret ? 'the stored secret was returned in cleartext' : undefined,
    });

    await client.call({
      name: 'admin lists IMAP configs',
      method: 'GET',
      path: '/system/imap',
      actor: 'admin',
      query: { page: 1, limit: 20 },
      expect: 200,
    });

    await client.call({
      name: 'admin patches the IMAP config',
      method: 'PATCH',
      path: '/system/imap/{id}',
      params: { id: imap.body.id },
      actor: 'admin',
      body: { name: `api-suite-imap-${stamp}-renamed` },
      expect: 200,
    });

    await client.call({
      name: 'admin activates the IMAP config',
      method: 'POST',
      path: '/system/imap/{id}/activate',
      params: { id: imap.body.id },
      actor: 'admin',
      expect: [200, 201, 204],
    });

    await client.call({
      name: 'testing an unreachable IMAP host reports failure rather than crashing',
      method: 'POST',
      path: '/system/imap/{id}/test',
      params: { id: imap.body.id },
      actor: 'admin',
      expect: [200, 201, 400, 422, 502, 503, 504],
      soft: true,
    });
  }

  // -------------------------------------------------------------- integrations

  const integration = await client.call({
    name: 'admin stores an integration credential',
    method: 'POST',
    path: '/system/integrations',
    actor: 'admin',
    body: {
      provider: 'api-suite',
      name: `probe-${stamp}`,
      kind: 'api_key',
      secret: 'integration-secret-value',
      meta: { createdBy: 'live-api-suite' },
      expiresAt: isoDateTime(30),
    },
    expect: 201,
    assert: (b) => (b?.secret ? 'creation echoed the secret back' : undefined),
  });

  if (integration.ok) {
    ctx.ids.integrationId = integration.body.id;

    await client.call({
      name: 'admin reads the integration without the secret',
      method: 'GET',
      path: '/system/integrations/{id}',
      params: { id: integration.body.id },
      actor: 'admin',
      expect: 200,
      assert: (b) =>
        b?.secret ? 'the stored secret was returned in cleartext' : undefined,
    });

    await client.call({
      name: 'admin filters integrations by provider',
      method: 'GET',
      path: '/system/integrations',
      actor: 'admin',
      query: { provider: 'api-suite', page: 1, limit: 20 },
      expect: 200,
      assert: (b) => {
        const rows: any[] = b?.data ?? [];
        const foreign = rows.find((r) => r.provider !== 'api-suite');
        return foreign
          ? `provider filter leaked ${foreign.provider}`
          : undefined;
      },
    });

    await client.call({
      name: 'admin rotates the integration secret',
      method: 'PATCH',
      path: '/system/integrations/{id}',
      params: { id: integration.body.id },
      actor: 'admin',
      body: { secret: 'rotated-secret-value' },
      expect: 200,
    });

    await client.call({
      name: 'a standard user cannot read integration credentials',
      method: 'GET',
      path: '/system/integrations/{id}',
      params: { id: integration.body.id },
      actor: 'user',
      expect: 403,
    });
  }
}
