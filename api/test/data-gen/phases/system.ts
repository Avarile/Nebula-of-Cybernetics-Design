import { create, type GenContext } from '../context';
import * as f from '../fake';
import { scaled, VOLUME } from '../volume';

/**
 * Operator surface: settings, flags, transports, suppressions and templates.
 *
 * Every write here is admin-only, and every setting write also lands a row in
 * `system_setting_revisions` — the audit trail is a side effect of the same
 * call, not a separate one to make.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp } = ctx;
  client.beginSuite('system');

  const TYPES = ['string', 'number', 'boolean', 'json'] as const;
  for (let i = 0; i < scaled(VOLUME.settings); i += 1) {
    const type = f.pick(TYPES, i);
    const value =
      type === 'string'
        ? `${f.topic(i)}-${i}`
        : type === 'number'
          ? 100 + i
          : type === 'boolean'
            ? i % 2 === 0
            : { topic: f.topic(i), index: i, run: stamp };
    await create(ctx, 'system_settings', {
      name: `setting ${i}`,
      method: 'PUT',
      path: '/system/settings/{key}',
      params: { key: `datagen.${f.topic(i).replace(/\s+/g, '_')}.${i}` },
      actor: 'admin',
      body: {
        value,
        type,
        category: f.pick(['general', 'finance', 'crm', 'ops', 'search'], i),
        description: `Generated setting for ${f.topic(i)}.`,
      },
      expect: [200, 201, 204],
    });
  }

  for (let i = 0; i < scaled(VOLUME.featureFlags); i += 1) {
    await create(ctx, 'feature_flags', {
      name: `feature flag ${i}`,
      method: 'PUT',
      path: '/system/feature-flags/{key}',
      params: { key: `datagen.${f.topic(i).replace(/\s+/g, '_')}_${i}` },
      actor: 'admin',
      body: {
        description: `Rollout switch for ${f.topic(i)}.`,
        enabled: i % 3 !== 0,
        // A mix of global and targeted rollouts, so the targeting branch of the
        // evaluator is exercised rather than only the global switch.
        rollout:
          i % 4 === 0
            ? { userIds: [ctx.mockUserId] }
            : i % 4 === 1
              ? { percentage: (i * 7) % 100 }
              : {},
        ...(i % 5 === 0 ? { expiresAt: f.isoDateTime(90 + i) } : {}),
      },
      expect: [200, 201, 204],
    });
  }

  for (let i = 0; i < scaled(VOLUME.smtpConfigs); i += 1) {
    await create(ctx, 'smtp_configs', {
      name: `smtp ${i}`,
      method: 'POST',
      path: '/system/smtp',
      actor: 'admin',
      body: {
        name: `Generated SMTP ${i} ${stamp}`,
        host: `smtp${i}.gen-${stamp}.example.com`,
        port: f.pick([25, 465, 587, 2525], i),
        username: `mailer-${i}`,
        secret: `generated-smtp-secret-${i}`,
        secure: i % 2 === 0,
        fromAddress: `no-reply+${i}.${stamp}@cybernetics.test`,
        fromName: `Cybernetics ${i}`,
      },
      expect: 201,
    });
  }

  for (let i = 0; i < scaled(VOLUME.imapConfigs); i += 1) {
    await create(ctx, 'imap_configs', {
      name: `imap ${i}`,
      method: 'POST',
      path: '/system/imap',
      actor: 'admin',
      body: {
        name: `Generated IMAP ${i} ${stamp}`,
        host: `imap${i}.gen-${stamp}.example.com`,
        port: f.pick([143, 993], i),
        username: `ingest-${i}@cybernetics.test`,
        secret: `generated-imap-secret-${i}`,
        secure: true,
      },
      expect: 201,
    });
  }

  for (let i = 0; i < scaled(VOLUME.integrations); i += 1) {
    await create(ctx, 'integration_credentials', {
      name: `integration ${i}`,
      method: 'POST',
      path: '/system/integrations',
      actor: 'admin',
      body: {
        provider: f.pick(
          ['slack', 'xero', 'stripe', 'github', 'hubspot', 'twilio'],
          i,
        ),
        name: `Generated integration ${i} ${stamp}`,
        kind: f.pick(['api_key', 'oauth2', 'basic', 'bearer'], i),
        secret: `generated-integration-secret-${i}`,
        meta: { workspace: `gen-${i}`, run: stamp },
        ...(i % 3 === 0 ? { expiresAt: f.isoDateTime(180 + i) } : {}),
      },
      expect: 201,
    });
  }

  const REASONS = [
    'hard_bounce',
    'soft_bounce_repeated',
    'complaint',
    'unsubscribe',
    'manual',
    'invalid',
  ] as const;
  for (let i = 0; i < scaled(VOLUME.suppressions); i += 1) {
    const reason = f.pick(REASONS, i);
    await create(ctx, 'notification_suppressions', {
      name: `suppression ${i}`,
      method: 'POST',
      path: '/system/notifications/suppressions',
      actor: 'admin',
      body: {
        email: f.email(i + 900, stamp),
        reason,
        // Soft bounces expire; hard bounces must not.
        ...(reason === 'soft_bounce_repeated'
          ? { expiresAt: f.isoDateTime(30 + i) }
          : {}),
      },
      expect: [201, 200, 204, 409],
    });
  }

  const events = await client.call({
    name: 'read notification event types',
    method: 'GET',
    path: '/system/notifications/event-types',
    actor: 'admin',
    expect: 200,
  });
  const eventKeys: string[] = Array.isArray(events.body)
    ? events.body.map((e: any) => e.key).filter(Boolean)
    : [];

  for (let i = 0; i < scaled(VOLUME.templates) && eventKeys.length; i += 1) {
    const key = f.pick(eventKeys, i);
    await create(ctx, 'notification_templates', {
      name: `template ${key}`,
      method: 'PUT',
      path: '/system/notifications/templates/{key}',
      params: { key: `datagen.${key}.${i}` },
      actor: 'admin',
      body: {
        locale: 'en',
        name: `Generated template for ${key}`,
        description: `Covers ${f.topic(i)}.`,
        subjectTemplate: `[{{siteName}}] ${f.topic(i)} update`,
        bodyTextTemplate: `Hello {{recipientName}},\n\n${f.paragraph(i, 3)}\n\n— {{siteName}}`,
        bodyHtmlTemplate: `<p>Hello {{recipientName}},</p><p>${f.paragraph(i, 3)}</p>`,
        variables: { siteName: 'string', recipientName: 'string' },
        isActive: true,
      },
      expect: [200, 201, 204],
    });
  }

  // One call per preference — `PUT /notifications/preferences` sets a single
  // event, not a matrix. Mandatory events ignore preferences entirely, so this
  // only bites on the optional ones.
  const FREQUENCIES = [
    'immediate',
    'hourly',
    'daily',
    'weekly',
    'off',
  ] as const;
  for (const actor of ['admin', 'user'] as const) {
    for (let i = 0; i < Math.min(eventKeys.length, 10); i += 1) {
      await create(ctx, 'notification_preferences', {
        name: `preference ${eventKeys[i]} (${actor})`,
        method: 'PUT',
        path: '/notifications/preferences',
        actor,
        body: {
          eventKey: eventKeys[i],
          enabled: i % 3 !== 0,
          frequency: f.pick(FREQUENCIES, i),
          ...(i % 4 === 0 ? { quietHoursStart: 22, quietHoursEnd: 7 } : {}),
        },
        expect: [200, 201, 204],
      });
    }
  }
}
