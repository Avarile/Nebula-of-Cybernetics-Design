import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  contactChannels,
  contactTags,
  contacts,
  type ContactChannelRow,
  type ContactRow,
  type NewContactChannelRow,
  type NewContactRow,
} from '../../infrastructure/database/schema/contact.schema';

export interface ContactQuery {
  search?: string;
  status?: ContactRow['status'];
  typeId?: string;
  categoryId?: string;
  companyId?: string;
  ownerUserId?: string;
  tagId?: string;
  /** Non-admin reads are narrowed to this principal's own + shared rows. */
  visibleTo?: string;
  page: number;
  limit: number;
}

/** Normalize an address for the dedup key: lowercase, trimmed. */
export function normalizeEmail(
  email: string | null | undefined,
): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

@Injectable()
export class ContactRepository extends BaseRepository<typeof contacts> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, contacts);
  }

  async findLiveById(id: string): Promise<ContactRow | null> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByNormalizedEmail(email: string): Promise<ContactRow | null> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.emailNormalized, email), eq(contacts.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Insert, or update the contact already holding this address.
   *
   * This is what makes deduplication automatic. Ingest paths — inbound email,
   * import, an agent — meet known addresses constantly; a bare insert would
   * fail the unique index on perfectly valid mail, so every write goes through
   * here. `ON CONFLICT` needs the index's own predicate in `targetWhere`,
   * because the index is partial.
   *
   * Only null-ish columns are overwritten on conflict: an ingest learning a
   * display name should fill one in, never replace a curated one.
   */
  async upsertByEmail(values: NewContactRow): Promise<ContactRow> {
    const emailNormalized = normalizeEmail(values.primaryEmail);
    if (!emailNormalized) {
      const rows = await this.db
        .insert(contacts)
        .values({ ...values, emailNormalized: null })
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(contacts)
      .values({ ...values, emailNormalized })
      .onConflictDoUpdate({
        target: contacts.emailNormalized,
        targetWhere: sql`${contacts.emailNormalized} IS NOT NULL AND ${contacts.isDeleted} = false`,
        set: {
          displayName: sql`COALESCE(NULLIF(${contacts.displayName}, ''), EXCLUDED.display_name)`,
          firstName: sql`COALESCE(${contacts.firstName}, EXCLUDED.first_name)`,
          lastName: sql`COALESCE(${contacts.lastName}, EXCLUDED.last_name)`,
          companyId: sql`COALESCE(${contacts.companyId}, EXCLUDED.company_id)`,
          jobTitle: sql`COALESCE(${contacts.jobTitle}, EXCLUDED.job_title)`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0];
  }

  async list(q: ContactQuery): Promise<{ rows: ContactRow[]; total: number }> {
    const filters: SQL[] = [eq(contacts.isDeleted, false)];
    if (q.status) filters.push(eq(contacts.status, q.status));
    if (q.typeId) filters.push(eq(contacts.typeId, q.typeId));
    if (q.categoryId) filters.push(eq(contacts.categoryId, q.categoryId));
    if (q.companyId) filters.push(eq(contacts.companyId, q.companyId));
    if (q.ownerUserId) filters.push(eq(contacts.ownerUserId, q.ownerUserId));
    if (q.search) {
      const pattern = `%${q.search}%`;
      filters.push(
        or(
          ilike(contacts.displayName, pattern),
          ilike(contacts.primaryEmail, pattern),
        )!,
      );
    }
    // Row-level narrowing, applied in SQL rather than after the fact: filtering
    // a page in memory silently shrinks it and breaks the total.
    if (q.visibleTo) {
      filters.push(
        or(
          eq(contacts.ownerUserId, q.visibleTo),
          eq(contacts.visibility, 'shared'),
        )!,
      );
    }
    if (q.tagId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM ${contactTags} WHERE ${contactTags.contactId} = ${contacts.id}
              AND ${contactTags.tagId} = ${q.tagId} AND ${contactTags.isDeleted} = false)`,
      );
    }
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(asc(contacts.displayName))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(contacts)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewContactRow>,
  ): Promise<ContactRow | null> {
    const rows = await this.db
      .update(contacts)
      .set(patch)
      .where(and(eq(contacts.id, id), eq(contacts.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(contacts)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(contacts.id, id));
  }

  async touchLastContacted(id: string, at: Date): Promise<void> {
    await this.db
      .update(contacts)
      .set({ lastContactedAt: at })
      .where(eq(contacts.id, id));
  }

  // --- channels ---

  async listChannels(contactId: string): Promise<ContactChannelRow[]> {
    return this.db
      .select()
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.contactId, contactId),
          eq(contactChannels.isDeleted, false),
        ),
      )
      .orderBy(desc(contactChannels.isPrimary), asc(contactChannels.kind));
  }

  /** Resolve an address to its contact — the inbound-email join. */
  async findContactIdByChannel(
    kind: ContactChannelRow['kind'],
    value: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ contactId: contactChannels.contactId })
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.kind, kind),
          eq(contactChannels.value, value.toLowerCase()),
          eq(contactChannels.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0]?.contactId ?? null;
  }

  async addChannel(
    values: NewContactChannelRow & { value: string },
  ): Promise<ContactChannelRow> {
    const rows = await this.db
      .insert(contactChannels)
      .values({ ...values, value: values.value.toLowerCase() })
      .returning();
    return rows[0];
  }

  async removeChannel(id: string): Promise<boolean> {
    const rows = await this.db
      .update(contactChannels)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(contactChannels.id, id), eq(contactChannels.isDeleted, false)),
      )
      .returning({ id: contactChannels.id });
    return rows.length > 0;
  }

  /** Clear any existing primary for this (contact, kind) before setting one. */
  async clearPrimary(
    contactId: string,
    kind: ContactChannelRow['kind'],
  ): Promise<void> {
    await this.db
      .update(contactChannels)
      .set({ isPrimary: false })
      .where(
        and(
          eq(contactChannels.contactId, contactId),
          eq(contactChannels.kind, kind),
          eq(contactChannels.isPrimary, true),
        ),
      );
  }

  // --- tags ---

  async tagIdsFor(contactId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: contactTags.tagId })
      .from(contactTags)
      .where(
        and(
          eq(contactTags.contactId, contactId),
          eq(contactTags.isDeleted, false),
        ),
      );
    return rows.map((r) => r.tagId);
  }

  async setTags(
    contactId: string,
    tagIds: string[],
    taggedBy: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(contactTags)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(
          and(
            eq(contactTags.contactId, contactId),
            eq(contactTags.isDeleted, false),
            // Anything held but no longer wanted. `notInArray` rather than raw
            // SQL so an empty list cannot produce `NOT IN ()`, which is invalid.
            tagIds.length > 0
              ? notInArray(contactTags.tagId, tagIds)
              : sql`true`,
          ),
        );
      if (tagIds.length === 0) return;
      const existing = await tx
        .select({ tagId: contactTags.tagId })
        .from(contactTags)
        .where(
          and(
            eq(contactTags.contactId, contactId),
            eq(contactTags.isDeleted, false),
            inArray(contactTags.tagId, tagIds),
          ),
        );
      const held = new Set(existing.map((e) => e.tagId));
      const missing = tagIds.filter((id) => !held.has(id));
      if (missing.length > 0) {
        await tx
          .insert(contactTags)
          .values(missing.map((tagId) => ({ contactId, tagId, taggedBy })));
      }
    });
  }
}
