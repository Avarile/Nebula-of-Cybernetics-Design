import { AgentReportSchema } from './mastra.types';
import { AGENT_ID, AGENT_RUN_QUEUE } from './mastra.constants';

describe('mastra shared contracts', () => {
  it('constants are stable ids', () => {
    expect(AGENT_ID).toBe('orchestrator');
    expect(AGENT_RUN_QUEUE).toBe('agent-run');
  });
  it('AgentReportSchema validates a report and defaults actions', () => {
    const r = AgentReportSchema.parse({
      summary: 's',
      findings: [{ title: 't', detail: 'd' }],
    });
    expect(r.recommendedActions).toEqual([]);
  });
});
