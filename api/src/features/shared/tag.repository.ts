import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  tags,
  type NewTagRow,
  type TagRow,
} from '../../infrastructure/database/schema/shared.schema';

export interface TagQuery {
  scope?: TagRow['scope'];
  page: number;
  limit: number;
}

/** Repository for the shared `tags` vocabulary — soft-delete aware. */
@Injectable()
export class TagRepository extends BaseRepository<typeof tags> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, tags);
  }

  async findLiveById(id: string): Promise<TagRow | null> {
    const rows = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The business key: a tag is unique per (scope, key) among live rows. */
  async findByScopedKey(
    scope: TagRow['scope'],
    key: string,
  ): Promise<TagRow | null> {
    const rows = await this.db
      .select()
      .from(tags)
      .where(
        and(
          eq(tags.scope, scope),
          eq(tags.key, key),
          eq(tags.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: TagQuery): Promise<{ rows: TagRow[]; total: number }> {
    const filters: SQL[] = [eq(tags.isDeleted, false)];
    if (q.scope) filters.push(eq(tags.scope, q.scope));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(tags)
      .where(where)
      .orderBy(desc(tags.usageCount), tags.key)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(tags)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async findManyLive(ids: string[]): Promise<TagRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tags)
      .where(and(inArray(tags.id, ids), eq(tags.isDeleted, false)));
  }

  async update(id: string, patch: Partial<NewTagRow>): Promise<TagRow | null> {
    const rows = await this.db
      .update(tags)
      .set(patch)
      .where(and(eq(tags.id, id), eq(tags.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(tags)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(tags.id, id));
  }

  /**
   * Adjust the denormalized usage counter.
   *
   * Written as a relative SQL update rather than read-modify-write so two
   * concurrent taggings cannot lose one another's increment. The counter is a
   * facet-ordering hint and is rebuildable, but a counter that drifts downward
   * under load is still worth avoiding for the cost of one expression.
   */
  async bumpUsage(
    id: string,
    delta: number,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(tags)
      .set({ usageCount: sql`GREATEST(0, ${tags.usageCount} + ${delta})` })
      .where(eq(tags.id, id));
  }
}
