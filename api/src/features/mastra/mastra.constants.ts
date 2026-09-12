import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

export const AGENT_ID = 'orchestrator';
export const SCHEDULED_REPORT_WORKFLOW_ID = 'scheduled-report';
export const AGENT_RUN_QUEUE = QUEUE_NAMES.agentRun;
export const RUN_SCHEDULE_JOB = 'run-schedule';
/** Job: relabel pending approvals whose deadline has passed. */
export const EXPIRE_APPROVALS_JOB = 'expire-approvals';
export const EXPIRE_APPROVALS_SCHEDULER_ID = 'agent-approval-expiry';
export const MASTRA_PG_SCHEMA = 'mastra';
export const REQUEST_CTX = {
  principal: 'principal',
  runId: 'runId',
  conversationId: 'conversationId',
} as const;
export const AGENT_RUN_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
};
