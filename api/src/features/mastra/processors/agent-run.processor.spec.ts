// `AgentRunProcessor` is constructed directly below (not through Nest's DI
// container), so the `@Processor`/`WorkerHost` decorator surface from
// `@nestjs/bullmq` never needs to run for real — stub it to a no-op. `@mastra/
// nestjs`'s build additionally pulls in Mastra's ESM-only server/editor stack,
// which breaks under Jest's default transformIgnorePatterns (see the same stub
// in `approval.service.spec.ts`/`agent-runner.service.spec.ts`), so stub it too
// rather than loading the real module.
jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => {},
  WorkerHost: class {},
}));
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));

import { AgentRunProcessor } from './agent-run.processor';

/**
 * `startResult` fixtures below mirror the CONFIRMED `WorkflowResult['status']`
 * union (`node_modules/@mastra/core/dist/workflows/types.d.ts` L569-635):
 * `'success' | 'failed' | 'tripwire' | 'suspended' | 'paused'`. `Run.start()`
 * RESOLVES (never rejects) for all of them, so the processor must branch on
 * `status` rather than assume a resolved promise means success.
 */
function make(startResult: unknown) {
  const schedule = {
    id: 'sched-1',
    enabled: true,
    agentId: 'orchestrator',
    targetUserId: null,
    promptTemplate: 'summarize last week',
    params: {},
    deliveryChannel: 'conversation',
    deliveryTarget: null,
  };
  const schedules = {
    findLiveById: jest.fn(async () => schedule),
    stampRun: jest.fn(async () => undefined),
  };
  const runs = {
    create: jest.fn(async () => ({ id: 'run-1' })),
    finish: jest.fn(async () => undefined),
  };
  const workflow = {
    createRun: async () => ({
      runId: 'mr1',
      start: async () => startResult,
    }),
  };
  const mastra = { getWorkflow: jest.fn(() => workflow) };
  const approvals = { expireOverdue: jest.fn(async () => 0) };
  const processor = new AgentRunProcessor(
    schedules as never,
    runs as never,
    approvals as never,
    mastra as never,
  );
  return { processor, schedules, runs, approvals, mastra, schedule };
}

const job = { name: 'run-schedule', data: { scheduleId: 'sched-1' } } as never;

describe('AgentRunProcessor.process', () => {
  it('marks the run succeeded and stamps the schedule succeeded on a "success" workflow result', async () => {
    const { processor, runs, schedules } = make({
      status: 'success',
      result: { summary: 'ok' },
    });

    await processor.process(job);

    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'succeeded', mastraRunId: 'mr1' }),
    );
    expect(schedules.stampRun).toHaveBeenCalledWith(
      'sched-1',
      'succeeded',
      'run-1',
    );
  });

  it('marks the run failed, stamps the schedule failed, and rethrows (for BullMQ retry) on a "failed" workflow result', async () => {
    const { processor, runs, schedules } = make({
      status: 'failed',
      error: new Error('workflow step blew up'),
    });

    await expect(processor.process(job)).rejects.toThrow(
      'workflow step blew up',
    );

    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: { message: 'workflow step blew up' },
      }),
    );
    expect(schedules.stampRun).toHaveBeenCalledWith(
      'sched-1',
      'failed',
      'run-1',
    );
    // Locks out the double-write regression: the 'failed' switch branch and
    // the execution try/catch must not BOTH run finish/stampRun for the same
    // failure (see the processor's comment on why they're no longer nested).
    expect(runs.finish).toHaveBeenCalledTimes(1);
    expect(schedules.stampRun).toHaveBeenCalledTimes(1);
  });

  it('marks the run failed, stamps the schedule failed exactly once, and rethrows on a genuine workflow-execution error', async () => {
    const schedule = {
      id: 'sched-1',
      enabled: true,
      agentId: 'orchestrator',
      targetUserId: null,
      promptTemplate: 'summarize last week',
      params: {},
      deliveryChannel: 'conversation',
      deliveryTarget: null,
    };
    const schedules = {
      findLiveById: jest.fn(async () => schedule),
      stampRun: jest.fn(async () => undefined),
    };
    const runs = {
      create: jest.fn(async () => ({ id: 'run-1' })),
      finish: jest.fn(async () => undefined),
    };
    const workflow = {
      createRun: async () => ({
        runId: 'mr1',
        start: async () => {
          throw new Error('createRun/start rejected outright');
        },
      }),
    };
    const mastra = { getWorkflow: jest.fn(() => workflow) };
    const processor = new AgentRunProcessor(
      schedules as never,
      runs as never,
      { expireOverdue: jest.fn(async () => 0) } as never,
      mastra as never,
    );

    await expect(processor.process(job)).rejects.toThrow(
      'createRun/start rejected outright',
    );

    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        error: { message: 'createRun/start rejected outright' },
      }),
    );
    expect(schedules.stampRun).toHaveBeenCalledWith(
      'sched-1',
      'failed',
      'run-1',
    );
    expect(runs.finish).toHaveBeenCalledTimes(1);
    expect(schedules.stampRun).toHaveBeenCalledTimes(1);
  });

  it('marks the run awaiting_approval (not succeeded) and stamps the schedule "suspended" on a "suspended" workflow result', async () => {
    const { processor, runs, schedules } = make({
      status: 'suspended',
      suspendPayload: { toolCallId: 'tc1' },
    });

    await processor.process(job);

    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(runs.finish).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(schedules.stampRun).toHaveBeenCalledWith(
      'sched-1',
      'suspended',
      'run-1',
    );
  });
});
