import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../../infrastructure/database/drizzle.constants';
import {
  agentActionLog,
  type NewAgentActionLogRow,
} from '../../../infrastructure/database/schema/agent.schema';
import type { ToolServices } from '../mastra.types';

/** Exact shape `ToolServices.recordAction` passes at the tool-call boundary. */
type ActionLogEntry = Parameters<ToolServices['recordAction']>[0];

/**
 * Repository for the append-only `agent_action_log` table (audit of every
 * side-effect the agent performed). No update/delete methods by design.
 */
@Injectable()
export class ActionLogRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Insert one audit entry. */
  async record(entry: ActionLogEntry): Promise<void> {
    if (!entry.runId)
      throw new Error('ActionLogRepository.record requires a runId');
    await this.db
      .insert(agentActionLog)
      .values(entry as unknown as NewAgentActionLogRow);
  }
}
