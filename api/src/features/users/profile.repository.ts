import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  userPreferences,
  userProfiles,
  type NewUserProfileRow,
  type UserPreferenceRow,
  type UserProfileRow,
} from '../../infrastructure/database/schema/profile.schema';

@Injectable()
export class ProfileRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByUserId(userId: string): Promise<UserProfileRow | null> {
    const rows = await this.db
      .select()
      .from(userProfiles)
      .where(
        and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Create-or-update by user id.
   *
   * The row is created lazily on first write rather than at signup, so `users`
   * — which every token validation reads — stays exactly as narrow as
   * authentication needs it.
   */
  async upsert(
    userId: string,
    patch: Partial<NewUserProfileRow>,
  ): Promise<UserProfileRow> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      const rows = await this.db
        .update(userProfiles)
        .set(patch)
        .where(eq(userProfiles.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(userProfiles)
      .values({ userId, ...patch })
      .returning();
    return rows[0];
  }

  /**
   * Null out the PII columns, keeping the row.
   *
   * An erasure request covers `user_profiles`, `contacts`, `contact_channels`,
   * `email_messages` and `activity_log.ip`, and nothing else — that register is
   * recorded in `profile.schema.ts` so the request is answerable in minutes.
   */
  async anonymize(userId: string): Promise<void> {
    await this.db
      .update(userProfiles)
      .set({
        firstName: null,
        lastName: null,
        phone: null,
        bio: null,
        avatarFileId: null,
        metadata: {},
      })
      .where(eq(userProfiles.userId, userId));
  }

  // --- preferences ---

  async listPreferences(userId: string): Promise<UserPreferenceRow[]> {
    return this.db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, userId),
          eq(userPreferences.isDeleted, false),
        ),
      )
      .orderBy(asc(userPreferences.key));
  }

  async findPreference(
    userId: string,
    key: string,
  ): Promise<UserPreferenceRow | null> {
    const rows = await this.db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, userId),
          eq(userPreferences.key, key),
          eq(userPreferences.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertPreference(
    userId: string,
    key: string,
    valueJson: UserPreferenceRow['valueJson'],
    type: UserPreferenceRow['type'],
  ): Promise<UserPreferenceRow> {
    const existing = await this.findPreference(userId, key);
    if (existing) {
      const rows = await this.db
        .update(userPreferences)
        .set({ valueJson, type })
        .where(eq(userPreferences.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(userPreferences)
      .values({ userId, key, valueJson, type })
      .returning();
    return rows[0];
  }

  async deletePreference(userId: string, key: string): Promise<boolean> {
    const rows = await this.db
      .update(userPreferences)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(userPreferences.userId, userId),
          eq(userPreferences.key, key),
          eq(userPreferences.isDeleted, false),
        ),
      )
      .returning({ id: userPreferences.id });
    return rows.length > 0;
  }
}
