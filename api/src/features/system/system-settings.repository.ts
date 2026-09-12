import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  systemSettingRevisions,
  systemSettings,
  type NewSystemSettingRow,
  type SettingValue,
  type SystemSettingRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class SystemSettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByKey(key: string): Promise<SystemSettingRow | null> {
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(
        and(eq(systemSettings.key, key), eq(systemSettings.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: {
    category?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: SystemSettingRow[]; total: number }> {
    const filters: SQL[] = [eq(systemSettings.isDeleted, false)];
    if (q.category) filters.push(eq(systemSettings.category, q.category));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(where)
      .orderBy(systemSettings.key)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(systemSettings)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Insert or update by key, recording the value change.
   *
   * The row write and its `system_setting_revisions` entry share one
   * transaction: a history that can be missing the change it describes is worse
   * than no history, because it reads as "nobody touched it".
   *
   * Storing full old/new values is safe here and only here — `system_settings`
   * is non-secret by design, which is exactly why `system_audit_log` records
   * field names alone (it also covers the credential tables).
   */
  async upsertByKey(
    key: string,
    patch: Omit<NewSystemSettingRow, 'key'>,
    ctx?: { changedBy?: string | null; reason?: string | null },
  ): Promise<SystemSettingRow> {
    return this.db.transaction(async (tx) => {
      const existing = await this.findByKey(key);
      const row = existing
        ? (
            await tx
              .update(systemSettings)
              .set({ ...patch, version: existing.version + 1 })
              .where(eq(systemSettings.id, existing.id))
              .returning()
          )[0]
        : (
            await tx
              .insert(systemSettings)
              .values({ key, ...patch })
              .returning()
          )[0];

      await tx.insert(systemSettingRevisions).values({
        settingId: row.id,
        key,
        oldValueJson: (existing?.valueJson ?? null) as SettingValue | null,
        newValueJson: row.valueJson,
        changedBy: ctx?.changedBy ?? null,
        reason: ctx?.reason ?? null,
      });
      return row;
    });
  }

  /** Revision history for one setting, newest first. */
  async listRevisions(key: string, limit: number) {
    return this.db
      .select()
      .from(systemSettingRevisions)
      .where(eq(systemSettingRevisions.key, key))
      .orderBy(desc(systemSettingRevisions.createdAt))
      .limit(limit);
  }

  async softDelete(key: string): Promise<boolean> {
    const rows = await this.db
      .update(systemSettings)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(systemSettings.key, key), eq(systemSettings.isDeleted, false)),
      )
      .returning();
    return rows.length > 0;
  }
}
