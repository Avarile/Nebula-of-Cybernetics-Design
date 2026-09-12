import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import {
  agentRuns,
  type NewAgentRunRow,
} from '../../../infrastructure/database/schema/agent.schema';

/**
 * Repository for the `agent_run` table (ledger of every agent invocation).
 *
 * `create` and `findById` are inherited from `BaseRepository`.
 */
@Injectable()
export class AgentRunRepository extends BaseRepository<typeof agentRuns> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, agentRuns);
  }

  /** Patch a run's terminal state (status, output, error, timings, ...). */
  async finish(id: string, patch: Partial<NewAgentRunRow>): Promise<void> {
    await this.db.update(agentRuns).set(patch).where(eq(agentRuns.id, id));
  }
}
