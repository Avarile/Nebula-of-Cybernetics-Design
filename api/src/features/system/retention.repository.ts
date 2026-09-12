import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  dataRetentionPolicies,
  type DataRetentionPolicyRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class RetentionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Every live policy, enabled or not — the admin view. */
  async listAll(): Promise<DataRetentionPolicyRow[]> {
    return this.db
      .select()
      .from(dataRetentionPolicies)
      .where(eq(dataRetentionPolicies.isDeleted, false))
      .orderBy(asc(dataRetentionPolicies.entityType));
  }

  /** Only what the sweep should act on. */
  async listEnabled(): Promise<DataRetentionPolicyRow[]> {
    return this.db
      .select()
      .from(dataRetentionPolicies)
      .where(
        and(
          eq(dataRetentionPolicies.isDeleted, false),
          eq(dataRetentionPolicies.enabled, true),
        ),
      )
      .orderBy(asc(dataRetentionPolicies.entityType));
  }

  async findByEntityType(
    entityType: DataRetentionPolicyRow['entityType'],
  ): Promise<DataRetentionPolicyRow | null> {
    const rows = await this.db
      .select()
      .from(dataRetentionPolicies)
      .where(
        and(
          eq(dataRetentionPolicies.entityType, entityType),
          eq(dataRetentionPolicies.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async recordRun(id: string, status: string, deleted: number): Promise<void> {
    await this.db
      .update(dataRetentionPolicies)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastDeletedCount: deleted,
      })
      .where(eq(dataRetentionPolicies.id, id));
  }

  async setEnabled(
    entityType: DataRetentionPolicyRow['entityType'],
    enabled: boolean,
  ): Promise<DataRetentionPolicyRow | null> {
    const rows = await this.db
      .update(dataRetentionPolicies)
      .set({ enabled })
      .where(
        and(
          eq(dataRetentionPolicies.entityType, entityType),
          eq(dataRetentionPolicies.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async setRetentionDays(
    entityType: DataRetentionPolicyRow['entityType'],
    retentionDays: number,
  ): Promise<DataRetentionPolicyRow | null> {
    const rows = await this.db
      .update(dataRetentionPolicies)
      .set({ retentionDays })
      .where(
        and(
          eq(dataRetentionPolicies.entityType, entityType),
          eq(dataRetentionPolicies.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
