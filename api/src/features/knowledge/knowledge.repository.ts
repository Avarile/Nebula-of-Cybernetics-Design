import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lte,
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
  knowledge,
  knowledgeTags,
  type KnowledgeRow,
  type NewKnowledgeRow,
} from '../../infrastructure/database/schema/knowledge.schema';

/**
 * Assigns `updated_at` to itself, suppressing `baseColumns.updatedAt`'s
 * `$onUpdate` for writes that are not edits. See `bumpViewCount`.
 */
const KEEP_UPDATED_AT = sql`${knowledge.updatedAt}`;

export interface KnowledgeQuery {
  search?: string;
  status?: KnowledgeRow['status'];
  typeId?: string;
  categoryId?: string;
  ownerUserId?: string;
  tagId?: string;
  page: number;
  limit: number;
}

@Injectable()
export class KnowledgeRepository extends BaseRepository<typeof knowledge> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, knowledge);
  }

  async findLiveById(id: string): Promise<KnowledgeRow | null> {
    const rows = await this.db
      .select()
      .from(knowledge)
      .where(and(eq(knowledge.id, id), eq(knowledge.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<KnowledgeRow | null> {
    const rows = await this.db
      .select()
      .from(knowledge)
      .where(and(eq(knowledge.slug, slug), eq(knowledge.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * A page of records, unfiltered by ACL.
   *
   * Access is applied by the service, which needs each record's grants to
   * decide. That is a deliberate difference from contacts, where the rule is
   * expressible as a SQL predicate: a grant-based policy is not, and pretending
   * otherwise would mean duplicating the resolver in SQL.
   */
  async list(
    q: KnowledgeQuery,
  ): Promise<{ rows: KnowledgeRow[]; total: number }> {
    const filters: SQL[] = [eq(knowledge.isDeleted, false)];
    if (q.status) filters.push(eq(knowledge.status, q.status));
    if (q.typeId) filters.push(eq(knowledge.typeId, q.typeId));
    if (q.categoryId) filters.push(eq(knowledge.categoryId, q.categoryId));
    if (q.ownerUserId) filters.push(eq(knowledge.ownerUserId, q.ownerUserId));
    if (q.search) {
      const pattern = `%${q.search}%`;
      filters.push(
        or(ilike(knowledge.title, pattern), ilike(knowledge.summary, pattern))!,
      );
    }
    if (q.tagId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM ${knowledgeTags} WHERE ${knowledgeTags.knowledgeId} = ${knowledge.id}
              AND ${knowledgeTags.tagId} = ${q.tagId} AND ${knowledgeTags.isDeleted} = false)`,
      );
    }
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(knowledge)
      .where(where)
      .orderBy(desc(knowledge.updatedAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(knowledge)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewKnowledgeRow>,
  ): Promise<KnowledgeRow | null> {
    const rows = await this.db
      .update(knowledge)
      .set(patch)
      .where(and(eq(knowledge.id, id), eq(knowledge.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(knowledge)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(knowledge.id, id));
  }

  /**
   * Increment the view counter without touching `updatedAt`.
   *
   * `baseColumns.updatedAt` carries `$onUpdate`, which Drizzle applies to any
   * column absent from `.set()`. So this — called from `KnowledgeService.get`,
   * on a pure read — used to restamp the record's modification time. `list()`
   * orders by `desc(updatedAt)`, so simply opening a record floated it to the
   * top of the listing as though it had been edited, and the body returned to
   * the caller carried the pre-bump timestamp, i.e. already stale. Assigning
   * the column to itself is a no-op write that suppresses `$onUpdate`
   * deterministically — the same guard `search_records` uses.
   */
  async bumpViewCount(id: string): Promise<void> {
    await this.db
      .update(knowledge)
      .set({
        viewCount: sql`${knowledge.viewCount} + 1`,
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(eq(knowledge.id, id));
  }

  /**
   * Published records whose review has fallen due.
   *
   * Hits `knowledge_review_due_idx`, which is partial on exactly this predicate
   * — the index therefore holds only rows the sweep can act on, however large
   * the corpus grows.
   */
  async dueForReview(now: Date, limit: number): Promise<KnowledgeRow[]> {
    return this.db
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.status, 'published'),
          eq(knowledge.isDeleted, false),
          lte(knowledge.reviewDueAt, now),
        ),
      )
      .orderBy(asc(knowledge.reviewDueAt))
      .limit(limit);
  }

  // --- tags ---

  async tagIdsFor(knowledgeId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: knowledgeTags.tagId })
      .from(knowledgeTags)
      .where(
        and(
          eq(knowledgeTags.knowledgeId, knowledgeId),
          eq(knowledgeTags.isDeleted, false),
        ),
      );
    return rows.map((r) => r.tagId);
  }

  async setTags(
    knowledgeId: string,
    tagIds: string[],
    taggedBy: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(knowledgeTags)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(
          and(
            eq(knowledgeTags.knowledgeId, knowledgeId),
            eq(knowledgeTags.isDeleted, false),
            tagIds.length > 0
              ? notInArray(knowledgeTags.tagId, tagIds)
              : sql`true`,
          ),
        );
      if (tagIds.length === 0) return;
      const existing = await tx
        .select({ tagId: knowledgeTags.tagId })
        .from(knowledgeTags)
        .where(
          and(
            eq(knowledgeTags.knowledgeId, knowledgeId),
            eq(knowledgeTags.isDeleted, false),
            inArray(knowledgeTags.tagId, tagIds),
          ),
        );
      const held = new Set(existing.map((e) => e.tagId));
      const missing = tagIds.filter((id) => !held.has(id));
      if (missing.length > 0) {
        await tx
          .insert(knowledgeTags)
          .values(missing.map((tagId) => ({ knowledgeId, tagId, taggedBy })));
      }
    });
  }
}
