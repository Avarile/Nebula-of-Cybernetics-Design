import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  contactCompanies,
  type ContactCompanyRow,
  type NewContactCompanyRow,
} from '../../infrastructure/database/schema/contact.schema';

export interface CompanyQuery {
  search?: string;
  status?: ContactCompanyRow['status'];
  ownerUserId?: string;
  page: number;
  limit: number;
}

@Injectable()
export class ContactCompanyRepository extends BaseRepository<
  typeof contactCompanies
> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, contactCompanies);
  }

  async findLiveById(id: string): Promise<ContactCompanyRow | null> {
    const rows = await this.db
      .select()
      .from(contactCompanies)
      .where(
        and(eq(contactCompanies.id, id), eq(contactCompanies.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** The natural key for matching an email domain to an organization. */
  async findByDomain(domain: string): Promise<ContactCompanyRow | null> {
    const rows = await this.db
      .select()
      .from(contactCompanies)
      .where(
        and(
          eq(contactCompanies.domain, domain.toLowerCase()),
          eq(contactCompanies.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    q: CompanyQuery,
  ): Promise<{ rows: ContactCompanyRow[]; total: number }> {
    const filters: SQL[] = [eq(contactCompanies.isDeleted, false)];
    if (q.status) filters.push(eq(contactCompanies.status, q.status));
    if (q.ownerUserId)
      filters.push(eq(contactCompanies.ownerUserId, q.ownerUserId));
    if (q.search) filters.push(ilike(contactCompanies.name, `%${q.search}%`));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(contactCompanies)
      .where(where)
      .orderBy(asc(contactCompanies.name))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(contactCompanies)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewContactCompanyRow>,
  ): Promise<ContactCompanyRow | null> {
    const rows = await this.db
      .update(contactCompanies)
      .set(patch)
      .where(
        and(eq(contactCompanies.id, id), eq(contactCompanies.isDeleted, false)),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(contactCompanies)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(contactCompanies.id, id));
  }
}
