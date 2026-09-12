import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  imapConfigs,
  type ImapConfigRow,
  type NewImapConfigRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class ImapConfigRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(values: NewImapConfigRow): Promise<ImapConfigRow> {
    const rows = await this.db.insert(imapConfigs).values(values).returning();
    return rows[0];
  }

  /** Ids of every live IMAP account, for schedulers that fan out per account. */
  async listLiveIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: imapConfigs.id })
      .from(imapConfigs)
      .where(eq(imapConfigs.isDeleted, false));
    return rows.map((r) => r.id);
  }

  async findActiveById(id: string): Promise<ImapConfigRow | null> {
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(and(eq(imapConfigs.id, id), eq(imapConfigs.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    page: number,
    limit: number,
  ): Promise<{ rows: ImapConfigRow[]; total: number }> {
    const where = eq(imapConfigs.isDeleted, false);
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(where)
      .orderBy(desc(imapConfigs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(imapConfigs)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewImapConfigRow>,
  ): Promise<ImapConfigRow | null> {
    const rows = await this.db
      .update(imapConfigs)
      .set(patch)
      .where(and(eq(imapConfigs.id, id), eq(imapConfigs.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(imapConfigs)
      .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
      .where(eq(imapConfigs.id, id));
  }

  async activate(id: string): Promise<ImapConfigRow | null> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(imapConfigs)
        .set({ isActive: false })
        .where(
          and(eq(imapConfigs.isActive, true), eq(imapConfigs.isDeleted, false)),
        );
      const rows = await tx
        .update(imapConfigs)
        .set({ isActive: true })
        .where(and(eq(imapConfigs.id, id), eq(imapConfigs.isDeleted, false)))
        .returning();
      return rows[0] ?? null;
    });
  }

  async stampTest(id: string, status: 'ok' | 'failed'): Promise<void> {
    await this.db
      .update(imapConfigs)
      .set({ lastTestedAt: new Date(), lastTestStatus: status })
      .where(eq(imapConfigs.id, id));
  }
}
