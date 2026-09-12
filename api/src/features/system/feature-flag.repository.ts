import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  featureFlags,
  type FeatureFlagRow,
  type NewFeatureFlagRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class FeatureFlagRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByKey(key: string): Promise<FeatureFlagRow | null> {
    const rows = await this.db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.key, key), eq(featureFlags.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listAll(): Promise<FeatureFlagRow[]> {
    return this.db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.isDeleted, false))
      .orderBy(asc(featureFlags.key));
  }

  async upsertByKey(
    key: string,
    patch: Partial<NewFeatureFlagRow>,
  ): Promise<FeatureFlagRow> {
    const existing = await this.findByKey(key);
    if (existing) {
      const rows = await this.db
        .update(featureFlags)
        .set(patch)
        .where(eq(featureFlags.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(featureFlags)
      .values({ key, ...patch })
      .returning();
    return rows[0];
  }

  async softDelete(key: string): Promise<boolean> {
    const rows = await this.db
      .update(featureFlags)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(and(eq(featureFlags.key, key), eq(featureFlags.isDeleted, false)))
      .returning();
    return rows.length > 0;
  }
}
