import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  activityLog,
  type ActivityLogRow,
  type NewActivityLogRow,
} from '../../infrastructure/database/schema/shared.schema';

/** Filters for a paginated activity read. */
export interface ActivityQuery {
  entityType?: ActivityLogRow['entityType'];
  entityId?: string;
  projectId?: string;
  actorUserId?: string;
  page: number;
  limit: number;
}

/**
 * Repository for `activity_log`. Append-only, so there is no update or
 * soft-delete path — only `purgeOlderThan`, which the retention sweep calls.
 */
@Injectable()
export class ActivityRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Append one row, optionally on a caller-supplied transaction.
   *
   * `executor` is what lets an activity row be written in the same transaction
   * as the change it records: if the business write rolls back, so does its
   * history, and the feed can never describe something that did not happen.
   */
  async append(
    row: NewActivityLogRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<ActivityLogRow> {
    const rows = await executor.insert(activityLog).values(row).returning();
    return rows[0];
  }

  /** Paginated read. Always ordered newest-first — this is a feed. */
  async list(
    q: ActivityQuery,
  ): Promise<{ rows: ActivityLogRow[]; total: number }> {
    const where = this.filters(q);
    const rows = await this.db
      .select()
      .from(activityLog)
      .where(where)
      .orderBy(desc(activityLog.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(activityLog)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Delete rows older than `cutoff`, at most `limit` per call.
   *
   * Bounded on purpose: an unbounded `DELETE` on a feed table holds locks for
   * as long as it takes, and a purge that stalls the table for a minute is
   * worse than one that takes an hour. The retention sweep loops until a call
   * returns fewer rows than the limit.
   */
  async purgeOlderThan(cutoff: Date, limit: number): Promise<number> {
    const doomed = await this.db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(lt(activityLog.createdAt, cutoff))
      .limit(limit);
    if (doomed.length === 0) return 0;
    await this.db.delete(activityLog).where(
      inArray(
        activityLog.id,
        doomed.map((d) => d.id),
      ),
    );
    return doomed.length;
  }

  private filters(q: ActivityQuery): SQL | undefined {
    const parts: SQL[] = [];
    if (q.entityType) parts.push(eq(activityLog.entityType, q.entityType));
    if (q.entityId) parts.push(eq(activityLog.entityId, q.entityId));
    if (q.projectId) parts.push(eq(activityLog.projectId, q.projectId));
    if (q.actorUserId) parts.push(eq(activityLog.actorUserId, q.actorUserId));
    return parts.length > 0 ? and(...parts) : undefined;
  }
}
