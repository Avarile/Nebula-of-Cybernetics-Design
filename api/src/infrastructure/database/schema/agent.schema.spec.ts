import {
  agentConversations,
  agentApprovals,
  agentSchedules,
  runStatus,
} from './agent.schema';

describe('agent.schema', () => {
  it('agent_conversation exposes id + owner + resource columns', () => {
    expect(agentConversations.id).toBeDefined();
    expect(agentConversations.ownerUserId).toBeDefined();
    expect(agentConversations.resourceId).toBeDefined();
  });
  it('agent_run status enum has the six states', () => {
    expect(runStatus.enumValues).toEqual([
      'queued',
      'running',
      'awaiting_approval',
      'succeeded',
      'failed',
      'cancelled',
    ]);
  });
  it('agent_approval references a run; agent_schedule has cron + enabled', () => {
    expect(agentApprovals.runId).toBeDefined();
    expect(agentSchedules.cron).toBeDefined();
    expect(agentSchedules.enabled).toBeDefined();
  });
});
