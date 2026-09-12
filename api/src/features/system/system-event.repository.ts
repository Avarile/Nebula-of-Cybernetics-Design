import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  systemEventLog,
  type NewSystemEventLogRow,
  type SystemEventLogRow,
} from '../../infrastructure/database/schema/system.schema';

export interface SystemEventQuery {
  severity?: SystemEventLogRow['severity'];
  source?: string;
  eventKey?: string;
  correlationId?: string;
  page: number;
  limit: number;
}

/** Repository for `system_event_log`. Append-only plus a bounded purge. */
@Injectable()
export class SystemEventRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async append(row: NewSystemEventLogRow): Promise<SystemEventLogRow> {
    const rows = await this.db.insert(systemEventLog).values(row).returning();
    return rows[0];
  }

  async list(
    q: SystemEventQuery,
  ): Promise<{ rows: SystemEventLogRow[]; total: number }> {
    const parts: SQL[] = [];
    if (q.severity) parts.push(eq(systemEventLog.severity, q.severity));
    if (q.source) parts.push(eq(systemEventLog.source, q.source));
    if (q.eventKey) parts.push(eq(systemEventLog.eventKey, q.eventKey));
    if (q.correlationId)
      parts.push(eq(systemEventLog.correlationId, q.correlationId));
    const where = parts.length > 0 ? and(...parts) : undefined;

    const rows = await this.db
      .select()
      .from(systemEventLog)
      .where(where)
      .orderBy(desc(systemEventLog.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(systemEventLog)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** Bounded delete for the retention sweep. See `RetentionService`. */
  async purgeOlderThan(cutoff: Date, limit: number): Promise<number> {
    const doomed = await this.db
      .select({ id: systemEventLog.id })
      .from(systemEventLog)
      .where(lt(systemEventLog.createdAt, cutoff))
      .limit(limit);
    if (doomed.length === 0) return 0;
    await this.db.delete(systemEventLog).where(
      inArray(
        systemEventLog.id,
        doomed.map((d) => d.id),
      ),
    );
    return doomed.length;
  }
}
