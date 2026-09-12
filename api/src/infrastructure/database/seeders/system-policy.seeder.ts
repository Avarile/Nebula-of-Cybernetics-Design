import type { DrizzleDB } from '../drizzle.constants';
import { dataRetentionPolicies, featureFlags } from '../schema/system.schema';
import type { Seeder } from './seeder.interface';
import { insertMissingByKey } from './seed.util';

/** Uniform window agreed for every governed table. */
const RETENTION_DAYS = 120;

/**
 * Retention rules and rollout switches.
 *
 * Retention is declarative so that adding a rule is a row rather than a new
 * scheduler. Two policies ship DISABLED on purpose:
 *
 *  - `email_messages` holds the mailbox archive, which `mailbox.schema.ts`
 *    documents as never hard-deleted; purging at 120 days would destroy stored
 *    correspondence.
 *  - `search_records` is the source of truth behind the Meilisearch read model;
 *    purging live records would silently empty search.
 *
 * Both are seeded at the agreed window so the intent is recorded, and left
 * `enabled = false` so nothing destructive runs until someone turns it on
 * deliberately. The other seven purge normally.
 */
const RETENTION: Array<{
  entityType: (typeof dataRetentionPolicies.entityType.enumValues)[number];
  enabled: boolean;
  description: string;
  /** Overrides {@link RETENTION_DAYS} where the uniform window does not fit. */
  retentionDays?: number;
}> = [
  {
    entityType: 'activity_log' as const,
    enabled: true,
    description: 'User-facing activity feed entries.',
  },
  {
    entityType: 'system_event_log' as const,
    enabled: true,
    description: 'Structured operational events.',
  },
  {
    entityType: 'notifications' as const,
    enabled: true,
    description: 'Sent and failed notification history.',
  },
  {
    entityType: 'notification_delivery_attempts' as const,
    enabled: true,
    description: 'Per-attempt SMTP diagnostics.',
  },
  {
    entityType: 'sessions' as const,
    enabled: true,
    description:
      'Expired and revoked refresh sessions. Expiry itself is enforced by auth-cleanup; this removes the rows afterwards.',
  },
  {
    entityType: 'password_reset_codes' as const,
    enabled: true,
    description: 'Consumed and expired reset codes.',
  },
  {
    entityType: 'email_messages' as const,
    enabled: false,
    description:
      'DISABLED: purging would destroy the mailbox archive. Enable only with an export in place.',
  },
  {
    entityType: 'search_records' as const,
    enabled: false,
    description:
      'DISABLED: this is the source of truth behind the search index, not a log.',
  },
  {
    entityType: 'scheduled_job' as const,
    enabled: true,
    retentionDays: 30,
    description:
      'Terminal poller rows (done/skipped/dead). Kept short so `scheduled_job` stays a working set rather than an archive; permanent history belongs in an append-only audit table, not the poller hot path.',
  },
];

/**
 * One flag per capability module, all off by default. Each module's routes stay
 * behind its flag until the feature is verified, so a bad release is a toggle
 * away from being contained rather than a rollback.
 */
const FLAGS = [
  ['module.rbac', 'Fine-grained permission checks (PermissionsGuard).'],
  ['module.user_profiles', 'User profile and preference endpoints.'],
  ['module.crm', 'Contacts, companies, relationships and interactions.'],
  ['module.knowledge', 'Knowledge base and access control.'],
  ['module.projects', 'Projects, tasks, goals, milestones and time entries.'],
  ['module.notifications', 'Email notification pipeline.'],
  ['module.finance', 'Budgets, transactions, invoicing and payments.'],
  ['module.calendar', 'Calendar events, occurrences and the reminder poller.'],
];

export class SystemPolicySeeder implements Seeder {
  readonly name = 'system-policy';

  async run(db: DrizzleDB): Promise<void> {
    const retentionCount = await insertMissingByKey(
      db,
      dataRetentionPolicies,
      dataRetentionPolicies.entityType,
      RETENTION.map((r) => ({
        entityType: r.entityType,
        // Per-policy override where the uniform window is wrong: `scheduled_job`
        // is high-churn operational state, not a 120-day record.
        retentionDays: r.retentionDays ?? RETENTION_DAYS,
        action: 'purge' as const,
        enabled: r.enabled,
        description: r.description,
      })),
      (r) => r.entityType,
    );

    const flagCount = await insertMissingByKey(
      db,
      featureFlags,
      featureFlags.key,
      FLAGS.map(([key, description]) => ({
        key,
        description,
        enabled: false,
        rollout: {},
      })),
      (r) => r.key,
    );

    console.log(
      `  ↳ retention policies +${retentionCount} (${RETENTION_DAYS}d, ` +
        `except where overridden), feature flags +${flagCount}`,
    );
  }
}
