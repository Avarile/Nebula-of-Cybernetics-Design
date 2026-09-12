import { isoDateTime } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Notifications, split across two controllers with two very different
 * audiences: `/notifications` is the recipient's own inbox and preferences,
 * `/system/notifications` is the operator's catalogue, templates and
 * suppression list.
 *
 * The suppression list is the one worth being careful about — it is the
 * mechanism that stops the platform mailing an address that bounced or
 * complained, so a leak of it to a standard account is a privacy problem, not
 * just a permissions one.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  // ------------------------------------------------------------- the inbox

  await client.call({
    name: 'user reads its notification inbox',
    method: 'GET',
    path: '/notifications',
    actor: 'user',
    query: { page: 1, limit: 50 },
    expect: 200,
    assert: (b) =>
      Array.isArray(b?.data) ? undefined : 'expected a paginated envelope',
  });

  await client.call({
    name: 'the inbox requires authentication',
    method: 'GET',
    path: '/notifications',
    actor: 'anon',
    expect: 401,
  });

  // --------------------------------------------------------- the event types

  const eventTypes = await client.call({
    name: 'admin lists the notification event catalogue',
    method: 'GET',
    path: '/system/notifications/event-types',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0 ? undefined : 'no event types are seeded';
    },
  });

  const events: any[] = Array.isArray(eventTypes.body) ? eventTypes.body : [];
  const optional = events.find((e) => !e.isMandatory) ?? events[0];
  ctx.facts.notificationEventKey = optional?.key;

  await client.call({
    name: 'a standard user cannot read the event catalogue',
    method: 'GET',
    path: '/system/notifications/event-types',
    actor: 'user',
    expect: 403,
  });

  // ------------------------------------------------------------- preferences

  await client.call({
    name: 'user reads its notification preferences',
    method: 'GET',
    path: '/notifications/preferences',
    actor: 'user',
    expect: 200,
  });

  if (ctx.facts.notificationEventKey) {
    const eventKey = ctx.facts.notificationEventKey;

    await client.call({
      name: 'user sets a daily digest with quiet hours',
      method: 'PUT',
      path: '/notifications/preferences',
      actor: 'user',
      body: {
        eventKey,
        enabled: true,
        frequency: 'daily',
        quietHoursStart: 22,
        quietHoursEnd: 7,
      },
      expect: [200, 201, 204],
    });

    await client.call({
      name: 'the preference is read back',
      method: 'GET',
      path: '/notifications/preferences',
      actor: 'user',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        const row = rows.find((p) => p.eventKey === eventKey);
        if (!row) return 'the preference just set is not listed';
        return row.frequency === 'daily'
          ? undefined
          : `frequency was ${row.frequency}`;
      },
    });

    await client.call({
      name: 'an out-of-range quiet hour is rejected',
      method: 'PUT',
      path: '/notifications/preferences',
      actor: 'user',
      body: { eventKey, quietHoursStart: 30 },
      expect: [400, 422],
    });

    await client.call({
      name: 'an unknown frequency is rejected',
      method: 'PUT',
      path: '/notifications/preferences',
      actor: 'user',
      body: { eventKey, frequency: 'fortnightly' },
      expect: 400,
    });

    await client.call({
      name: 'a preference for an unknown event key is refused',
      method: 'PUT',
      path: '/notifications/preferences',
      actor: 'user',
      body: { eventKey: `no.such.event.${stamp}`, enabled: false },
      expect: [400, 404, 422],
    });
  }

  // --------------------------------------------------------------- templates

  await client.call({
    name: 'admin lists notification templates',
    method: 'GET',
    path: '/system/notifications/templates',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0 ? undefined : 'no templates are seeded';
    },
  });

  await client.call({
    name: 'a standard user cannot read notification templates',
    method: 'GET',
    path: '/system/notifications/templates',
    actor: 'user',
    expect: 403,
  });

  const templateKey = `apisuite.template.${stamp}`;
  ctx.ids.templateKey = templateKey;

  await client.call({
    name: 'admin writes a notification template',
    method: 'PUT',
    path: '/system/notifications/templates/{key}',
    params: { key: templateKey },
    actor: 'admin',
    body: {
      locale: 'en',
      name: 'API Suite Probe Template',
      description: 'Written by the live API suite.',
      subjectTemplate: 'Probe: {{subject}}',
      bodyTextTemplate:
        'Hello {{name}},\n\nThis is a probe from the live API suite.\n',
      bodyHtmlTemplate: '<p>Hello {{name}},</p><p>This is a probe.</p>',
      variables: {
        name: 'Recipient display name',
        subject: 'Line of interest',
      },
      isActive: true,
    },
    expect: [200, 201],
  });

  await client.call({
    name: 'a template needs a subject and a text body',
    method: 'PUT',
    path: '/system/notifications/templates/{key}',
    params: { key: `${templateKey}.bad` },
    actor: 'admin',
    body: { name: 'Incomplete' },
    expect: 400,
  });

  await client.call({
    name: 'the written template appears in the listing',
    method: 'GET',
    path: '/system/notifications/templates',
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((t) => t.key === templateKey)
        ? undefined
        : 'the template just written is not listed';
    },
  });

  // ------------------------------------------------------------ suppressions

  const suppressed = `bounced.${stamp}@cybernetics.test`;
  ctx.ids.suppressionEmail = suppressed;

  await client.call({
    name: 'a standard user cannot read the suppression list',
    method: 'GET',
    path: '/system/notifications/suppressions',
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin suppresses a hard-bouncing address',
    method: 'POST',
    path: '/system/notifications/suppressions',
    actor: 'admin',
    body: {
      email: suppressed,
      reason: 'hard_bounce',
      note: 'Recorded by the live API suite.',
      expiresAt: isoDateTime(30),
    },
    expect: 204,
  });

  await client.call({
    name: 'an unknown suppression reason is rejected',
    method: 'POST',
    path: '/system/notifications/suppressions',
    actor: 'admin',
    body: { email: `other.${stamp}@cybernetics.test`, reason: 'vibes' },
    expect: 400,
  });

  await client.call({
    name: 'a malformed address cannot be suppressed',
    method: 'POST',
    path: '/system/notifications/suppressions',
    actor: 'admin',
    body: { email: 'not-an-email', reason: 'manual' },
    expect: 400,
  });

  await client.call({
    name: 'admin lists suppressions',
    method: 'GET',
    path: '/system/notifications/suppressions',
    actor: 'admin',
    query: { page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.some((s) => s.email === suppressed)
        ? undefined
        : 'the suppressed address is not listed';
    },
  });

  await client.call({
    name: 'admin lifts the suppression',
    method: 'DELETE',
    path: '/system/notifications/suppressions/{email}',
    params: { email: suppressed },
    actor: 'admin',
    expect: 204,
  });

  await client.call({
    name: 'the lifted address is gone from the list',
    method: 'GET',
    path: '/system/notifications/suppressions',
    actor: 'admin',
    query: { limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.some((s) => s.email === suppressed)
        ? 'the suppression was not lifted'
        : undefined;
    },
  });
}
