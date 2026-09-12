import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import { users } from '../../infrastructure/database/schema/identity.schema';
import {
  comments,
  type CommentRow,
  type NewCommentRow,
} from '../../infrastructure/database/schema/shared.schema';

export interface CommentQuery {
  entityType: CommentRow['entityType'];
  entityId: string;
  page: number;
  limit: number;
}

@Injectable()
export class CommentRepository extends BaseRepository<typeof comments> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, comments);
  }

  async findLiveById(id: string): Promise<CommentRow | null> {
    const rows = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** A thread, oldest first — a conversation reads forwards. */
  async list(q: CommentQuery): Promise<{ rows: CommentRow[]; total: number }> {
    const filters: SQL[] = [
      eq(comments.entityType, q.entityType),
      eq(comments.entityId, q.entityId),
      eq(comments.isDeleted, false),
    ];
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(comments)
      .where(where)
      .orderBy(asc(comments.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(comments)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewCommentRow>,
  ): Promise<CommentRow | null> {
    const rows = await this.db
      .update(comments)
      .set(patch)
      .where(and(eq(comments.id, id), eq(comments.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(comments)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(comments.id, id));
  }

  /**
   * Keep only the ids that name a live user account.
   *
   * Queried here rather than through `UsersModule` deliberately: this module is
   * cross-cutting and every capability module imports it, so depending on a
   * feature module would make the graph circular the moment any of them needed
   * `SharedModule` back (it did — Users -> Authorization -> Shared -> Users).
   * This is an existence check, not business logic.
   */
  async filterLiveUserIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.isDeleted, false)));
    return rows.map((r) => r.id);
  }

  /**
   * Soft-delete every comment on one entity — the polymorphic cascade.
   *
   * Takes an executor so it can join the transaction that removes the parent.
   * Run on its own connection, a crash between the two leaves a deleted record
   * whose discussion is still live and reachable by entity id.
   */
  async softDeleteForEntity(
    entityType: CommentRow['entityType'],
    entityId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(comments)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(comments.entityType, entityType),
          eq(comments.entityId, entityId),
          eq(comments.isDeleted, false),
        ),
      )
      .returning({ id: comments.id });
    return rows.length;
  }
}
