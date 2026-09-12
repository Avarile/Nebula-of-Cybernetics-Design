import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import {
  agentSchedules,
  type AgentScheduleRow,
} from '../../../infrastructure/database/schema/agent.schema';

/**
 * Repository for the `agent_schedule` table (admin-managed scheduled runs).
 *
 * `create` is inherited from `BaseRepository`.
 */
@Injectable()
export class ScheduleRepository extends BaseRepository<typeof agentSchedules> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, agentSchedules);
  }

  /** Enabled, non-deleted schedules (candidates for the reconcile scheduler). */
  async listEnabled(): Promise<AgentScheduleRow[]> {
    return this.db
      .select()
      .from(agentSchedules)
      .where(
        and(
          eq(agentSchedules.enabled, true),
          eq(agentSchedules.isDeleted, false),
        ),
      );
  }

  /** A live (non-deleted) schedule by id. */
  async findLiveById(id: string): Promise<AgentScheduleRow | null> {
    const rows = await this.db
      .select()
      .from(agentSchedules)
      .where(
        and(eq(agentSchedules.id, id), eq(agentSchedules.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Soft-delete a schedule. */
  async softDelete(id: string): Promise<void> {
    await this.db
      .update(agentSchedules)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(agentSchedules.id, id));
  }

  /** Stamp the outcome of the schedule's most recent run. */
  async stampRun(id: string, status: string, runId: string): Promise<void> {
    await this.db
      .update(agentSchedules)
      .set({ lastRunAt: new Date(), lastRunStatus: status, lastRunId: runId })
      .where(eq(agentSchedules.id, id));
  }
}
