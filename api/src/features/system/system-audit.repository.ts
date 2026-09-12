import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  systemAuditLog,
  type NewSystemAuditRow,
  type SystemAuditRow,
} from '../../infrastructure/database/schema/system.schema';

export interface AuditListQuery {
  page: number;
  limit: number;
  entityType?: string;
  entityId?: string;
  actorId?: string;
}

/** Append + read only. The audit log is never updated or deleted. */
@Injectable()
export class SystemAuditRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async insert(row: NewSystemAuditRow): Promise<void> {
    await this.db.insert(systemAuditLog).values(row);
  }

  async list(
    q: AuditListQuery,
  ): Promise<{ rows: SystemAuditRow[]; total: number }> {
    const filters: SQL[] = [];
    if (q.entityType) filters.push(eq(systemAuditLog.entityType, q.entityType));
    if (q.entityId) filters.push(eq(systemAuditLog.entityId, q.entityId));
    if (q.actorId) filters.push(eq(systemAuditLog.actorId, q.actorId));
    const where = filters.length ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(systemAuditLog)
      .where(where)
      .orderBy(desc(systemAuditLog.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(systemAuditLog)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }
}
