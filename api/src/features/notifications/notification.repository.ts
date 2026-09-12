import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  notificationDeliveryAttempts,
  notificationEventTypes,
  notificationPreferences,
  notificationSuppressions,
  notificationTemplates,
  notifications,
  type NewNotificationDeliveryAttemptRow,
  type NewNotificationRow,
  type NotificationEventTypeRow,
  type NotificationPreferenceRow,
  type NotificationRow,
  type NotificationSuppressionRow,
  type NotificationTemplateRow,
} from '../../infrastructure/database/schema/notification.schema';

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // --- catalog ---

  listEventTypes(): Promise<NotificationEventTypeRow[]> {
    return this.db
      .select()
      .from(notificationEventTypes)
      .where(eq(notificationEventTypes.isDeleted, false))
      .orderBy(
        asc(notificationEventTypes.category),
        asc(notificationEventTypes.key),
      );
  }

  async findEventType(key: string): Promise<NotificationEventTypeRow | null> {
    const rows = await this.db
      .select()
      .from(notificationEventTypes)
      .where(
        and(
          eq(notificationEventTypes.key, key),
          eq(notificationEventTypes.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Every event key in the catalog — the boot assertion's input. */
  async allEventKeys(): Promise<string[]> {
    const rows = await this.db
      .select({ key: notificationEventTypes.key })
      .from(notificationEventTypes)
      .where(eq(notificationEventTypes.isDeleted, false));
    return rows.map((r) => r.key);
  }

  // --- templates ---

  listTemplates(): Promise<NotificationTemplateRow[]> {
    return this.db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.isDeleted, false))
      .orderBy(asc(notificationTemplates.key));
  }

  /**
   * A template for a key, preferring the caller's locale.
   *
   * Falls back to `en` rather than failing: a user whose locale has no
   * translation should get the English mail, not silence.
   */
  async findTemplate(
    key: string,
    locale: string,
  ): Promise<NotificationTemplateRow | null> {
    const rows = await this.db
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.key, key),
          eq(notificationTemplates.isActive, true),
          eq(notificationTemplates.isDeleted, false),
          or(
            eq(notificationTemplates.locale, locale),
            eq(notificationTemplates.locale, 'en'),
          )!,
        ),
      );
    return (
      rows.find((r) => r.locale === locale) ??
      rows.find((r) => r.locale === 'en') ??
      null
    );
  }

  async upsertTemplate(
    key: string,
    locale: string,
    patch: Partial<NotificationTemplateRow>,
  ): Promise<NotificationTemplateRow> {
    const existing = await this.db
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.key, key),
          eq(notificationTemplates.locale, locale),
          eq(notificationTemplates.isDeleted, false),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const rows = await this.db
        .update(notificationTemplates)
        .set({ ...patch, version: existing[0].version + 1 })
        .where(eq(notificationTemplates.id, existing[0].id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(notificationTemplates)
      .values({
        key,
        locale,
        name: patch.name ?? key,
        subjectTemplate: patch.subjectTemplate ?? '',
        bodyTextTemplate: patch.bodyTextTemplate ?? '',
        ...patch,
      })
      .returning();
    return rows[0];
  }

  // --- preferences ---

  listPreferences(userId: string): Promise<NotificationPreferenceRow[]> {
    return this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.isDeleted, false),
        ),
      );
  }

  async findPreference(
    userId: string,
    eventTypeId: string,
  ): Promise<NotificationPreferenceRow | null> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.eventTypeId, eventTypeId),
          eq(notificationPreferences.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Preferences for many users at once, so a fan-out is one query. */
  async preferencesFor(
    userIds: string[],
    eventTypeId: string,
  ): Promise<Map<string, NotificationPreferenceRow>> {
    const byUser = new Map<string, NotificationPreferenceRow>();
    if (userIds.length === 0) return byUser;
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, userIds),
          eq(notificationPreferences.eventTypeId, eventTypeId),
          eq(notificationPreferences.isDeleted, false),
        ),
      );
    for (const row of rows) byUser.set(row.userId, row);
    return byUser;
  }

  async upsertPreference(
    userId: string,
    eventTypeId: string,
    patch: Partial<NotificationPreferenceRow>,
  ): Promise<NotificationPreferenceRow> {
    const existing = await this.findPreference(userId, eventTypeId);
    if (existing) {
      const rows = await this.db
        .update(notificationPreferences)
        .set(patch)
        .where(eq(notificationPreferences.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(notificationPreferences)
      .values({ userId, eventTypeId, ...patch })
      .returning();
    return rows[0];
  }

  // --- outbox ---

  /**
   * Write outbox rows, optionally on the caller's transaction.
   *
   * The executor is the whole point: the row must commit with the change it
   * announces. Sending inside the transaction emails on rollback; sending after
   * commit loses the message if the process dies between the two.
   *
   * `onConflictDoNothing` on the dedupe key makes a retried caller idempotent.
   */
  async enqueue(
    rows: NewNotificationRow[],
    executor: DrizzleExecutor = this.db,
  ): Promise<NotificationRow[]> {
    if (rows.length === 0) return [];
    return executor
      .insert(notifications)
      .values(rows)
      .onConflictDoNothing()
      .returning();
  }

  async findById(id: string): Promise<NotificationRow | null> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Claim a batch of sendable rows.
   *
   * Hits `notifications_sendable_idx`, which is partial on exactly this
   * predicate, so the index only ever holds unsent rows. Claiming flips them to
   * `queued` in the same statement, so two workers cannot pick up the same row.
   */
  async claimSendable(limit: number, now: Date): Promise<NotificationRow[]> {
    const rows = await this.db.execute<{ id: string }>(sql`
      UPDATE ${notifications} SET status = 'queued', updated_at = now()
      WHERE id IN (
        SELECT id FROM ${notifications}
        WHERE status = 'pending'
          AND is_deleted = false
          AND (scheduled_for IS NULL OR scheduled_for <= ${now})
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);
    const ids = rows.rows.map((r) => r.id);
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(notifications)
      .where(inArray(notifications.id, ids));
  }

  async markSent(id: string, providerMessageId: string | null): Promise<void> {
    await this.db
      .update(notifications)
      .set({ status: 'sent', sentAt: new Date(), providerMessageId })
      .where(eq(notifications.id, id));
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
    retryAt: Date | null,
  ): Promise<void> {
    await this.db
      .update(notifications)
      .set({
        // Back to `pending` while retries remain, so the same sweep picks it up
        // again; `failed` is terminal.
        status: retryAt ? 'pending' : 'failed',
        lastError: error.slice(0, 1000),
        attempts,
        scheduledFor: retryAt,
      })
      .where(eq(notifications.id, id));
  }

  async markSuppressed(id: string, reason: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ status: 'suppressed', lastError: reason.slice(0, 1000) })
      .where(eq(notifications.id, id));
  }

  async recordAttempt(
    values: NewNotificationDeliveryAttemptRow,
  ): Promise<void> {
    await this.db.insert(notificationDeliveryAttempts).values(values);
  }

  async listForRecipient(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const where = and(
      eq(notifications.recipientUserId, userId),
      eq(notifications.isDeleted, false),
    );
    const rows = await this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** Bounded delete for the retention sweep. */
  async purgeOlderThan(cutoff: Date, limit: number): Promise<number> {
    const doomed = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(lt(notifications.createdAt, cutoff))
      .limit(limit);
    if (doomed.length === 0) return 0;
    const ids = doomed.map((d) => d.id);
    // Attempts reference notifications, so they go first.
    await this.db
      .delete(notificationDeliveryAttempts)
      .where(inArray(notificationDeliveryAttempts.notificationId, ids));
    await this.db.delete(notifications).where(inArray(notifications.id, ids));
    return doomed.length;
  }

  async purgeAttemptsOlderThan(cutoff: Date, limit: number): Promise<number> {
    const doomed = await this.db
      .select({ id: notificationDeliveryAttempts.id })
      .from(notificationDeliveryAttempts)
      .where(lt(notificationDeliveryAttempts.createdAt, cutoff))
      .limit(limit);
    if (doomed.length === 0) return 0;
    await this.db.delete(notificationDeliveryAttempts).where(
      inArray(
        notificationDeliveryAttempts.id,
        doomed.map((d) => d.id),
      ),
    );
    return doomed.length;
  }

  // --- suppressions ---

  /**
   * The active suppression for an address, if any.
   *
   * Checked before every send. Without it, one hard bounce retried daily is how
   * a sending domain gets blacklisted.
   */
  async findSuppression(
    email: string,
    eventTypeId: string | null,
  ): Promise<NotificationSuppressionRow | null> {
    const rows = await this.db
      .select()
      .from(notificationSuppressions)
      .where(
        and(
          eq(notificationSuppressions.email, email.toLowerCase()),
          eq(notificationSuppressions.isDeleted, false),
          // A blanket suppression (null event type) covers everything.
          or(
            isNull(notificationSuppressions.eventTypeId),
            eventTypeId
              ? eq(notificationSuppressions.eventTypeId, eventTypeId)
              : isNull(notificationSuppressions.eventTypeId),
          )!,
          or(
            isNull(notificationSuppressions.expiresAt),
            sql`${notificationSuppressions.expiresAt} > now()`,
          )!,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async suppress(
    email: string,
    reason: NotificationSuppressionRow['reason'],
    eventTypeId: string | null,
    source: string,
    expiresAt: Date | null,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: notificationSuppressions.id })
      .from(notificationSuppressions)
      .where(
        and(
          eq(notificationSuppressions.email, email.toLowerCase()),
          eventTypeId
            ? eq(notificationSuppressions.eventTypeId, eventTypeId)
            : isNull(notificationSuppressions.eventTypeId),
          eq(notificationSuppressions.isDeleted, false),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(notificationSuppressions)
        .set({ reason, source, expiresAt })
        .where(eq(notificationSuppressions.id, existing[0].id));
      return;
    }
    await this.db.insert(notificationSuppressions).values({
      email: email.toLowerCase(),
      reason,
      eventTypeId,
      source,
      expiresAt,
    });
  }

  async unsuppress(email: string): Promise<boolean> {
    const rows = await this.db
      .update(notificationSuppressions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(notificationSuppressions.email, email.toLowerCase()),
          eq(notificationSuppressions.isDeleted, false),
        ),
      )
      .returning({ id: notificationSuppressions.id });
    return rows.length > 0;
  }

  listSuppressions(
    page: number,
    limit: number,
  ): Promise<NotificationSuppressionRow[]> {
    return this.db
      .select()
      .from(notificationSuppressions)
      .where(eq(notificationSuppressions.isDeleted, false))
      .orderBy(desc(notificationSuppressions.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
  }

  /** Rows due for a digest window, grouped by their digest key. */
  async claimDigestGroup(
    groupKey: string,
    limit: number,
  ): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.digestGroupKey, groupKey),
          eq(notifications.status, 'pending'),
          eq(notifications.isDeleted, false),
          lte(notifications.createdAt, new Date()),
        ),
      )
      .limit(limit);
  }
}
