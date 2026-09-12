import { Module } from '@nestjs/common';
import { ConversationRepository } from './repositories/conversation.repository';
import { AgentRunRepository } from './repositories/agent-run.repository';
import { ApprovalRepository } from './repositories/approval.repository';
import { ActionLogRepository } from './repositories/action-log.repository';
import { ScheduleRepository } from './repositories/schedule.repository';

const repositories = [
  ConversationRepository,
  AgentRunRepository,
  ApprovalRepository,
  ActionLogRepository,
  ScheduleRepository,
];

/**
 * Groups the Mastra Drizzle repositories into an exported provider set so they
 * are resolvable both by this feature's services (via `MastraModule.imports`)
 * and by the `@mastra/nestjs` dynamic module's `registerAsync` factory (via its
 * own `imports`). A dynamic module's `inject` tokens resolve only against the
 * modules listed in its `imports` plus global modules — not against the host
 * module's `providers` — so `ActionLogRepository` must be exported from a module
 * that the factory imports. All repositories depend solely on the global
 * `DRIZZLE` token, so no additional imports are required here.
 */
@Module({
  providers: repositories,
  exports: repositories,
})
export class MastraRepositoriesModule {}
