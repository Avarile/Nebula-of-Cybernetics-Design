import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  smtpConfigs,
  type NewSmtpConfigRow,
  type SmtpConfigRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class SmtpConfigRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(values: NewSmtpConfigRow): Promise<SmtpConfigRow> {
    const rows = await this.db.insert(smtpConfigs).values(values).returning();
    return rows[0];
  }

  async findActiveById(id: string): Promise<SmtpConfigRow | null> {
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(and(eq(smtpConfigs.id, id), eq(smtpConfigs.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    page: number,
    limit: number,
  ): Promise<{ rows: SmtpConfigRow[]; total: number }> {
    const where = eq(smtpConfigs.isDeleted, false);
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(where)
      .orderBy(desc(smtpConfigs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(smtpConfigs)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewSmtpConfigRow>,
  ): Promise<SmtpConfigRow | null> {
    const rows = await this.db
      .update(smtpConfigs)
      .set(patch)
      .where(and(eq(smtpConfigs.id, id), eq(smtpConfigs.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(smtpConfigs)
      .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
      .where(eq(smtpConfigs.id, id));
  }

  /** Transactionally enforce single-active: deactivate all, then activate id. */
  async activate(id: string): Promise<SmtpConfigRow | null> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(smtpConfigs)
        .set({ isActive: false })
        .where(
          and(eq(smtpConfigs.isActive, true), eq(smtpConfigs.isDeleted, false)),
        );
      const rows = await tx
        .update(smtpConfigs)
        .set({ isActive: true })
        .where(and(eq(smtpConfigs.id, id), eq(smtpConfigs.isDeleted, false)))
        .returning();
      return rows[0] ?? null;
    });
  }

  async stampTest(id: string, status: 'ok' | 'failed'): Promise<void> {
    await this.db
      .update(smtpConfigs)
      .set({ lastTestedAt: new Date(), lastTestStatus: status })
      .where(eq(smtpConfigs.id, id));
  }
}
