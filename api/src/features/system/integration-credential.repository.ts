import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  integrationCredentials,
  type IntegrationCredentialRow,
  type NewIntegrationCredentialRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class IntegrationCredentialRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(
    values: NewIntegrationCredentialRow,
  ): Promise<IntegrationCredentialRow> {
    const rows = await this.db
      .insert(integrationCredentials)
      .values(values)
      .returning();
    return rows[0];
  }

  async findActiveById(id: string): Promise<IntegrationCredentialRow | null> {
    const rows = await this.db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.id, id),
          eq(integrationCredentials.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByProviderAndName(
    provider: string,
    name: string,
  ): Promise<IntegrationCredentialRow | null> {
    const rows = await this.db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.provider, provider),
          eq(integrationCredentials.name, name),
          eq(integrationCredentials.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: {
    provider?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: IntegrationCredentialRow[]; total: number }> {
    const filters: SQL[] = [eq(integrationCredentials.isDeleted, false)];
    if (q.provider)
      filters.push(eq(integrationCredentials.provider, q.provider));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(integrationCredentials)
      .where(where)
      .orderBy(desc(integrationCredentials.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(integrationCredentials)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewIntegrationCredentialRow>,
  ): Promise<IntegrationCredentialRow | null> {
    const rows = await this.db
      .update(integrationCredentials)
      .set(patch)
      .where(
        and(
          eq(integrationCredentials.id, id),
          eq(integrationCredentials.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(integrationCredentials)
      .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
      .where(eq(integrationCredentials.id, id));
  }
}
