// `@mastra/nestjs`'s build pulls in Mastra's server/editor stack (ESM-only transitive
// deps), which breaks under Jest's default transformIgnorePatterns. `ChatStreamService`
// only uses `MastraService` for its type (DI token) and calls `.getAgent(...)` on the
// injected instance, so stub the module rather than loading the real one (mirrors
// `agent-runner.service.spec.ts`).
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));

import { ChatStreamService } from './chat-stream.service';

function fakeOutput(chunks: unknown[], finishReason = 'stop') {
  return {
    fullStream: (async function* () {
      for (const c of chunks) yield c;
    })(),
    text: Promise.resolve('final text'),
    usage: Promise.resolve({ inputTokens: 3, outputTokens: 5 }),
    finishReason: Promise.resolve(finishReason),
  };
}
const sink = () => {
  const frames: string[] = [];
  return { frames, write: (f: string) => frames.push(f) };
};
const config = () => ({ getOrThrow: () => ({ model: 'test-model' }) });
const deps = () => ({
  conversations: {
    ensure: jest.fn().mockResolvedValue({ id: 'conv-1', resourceId: 'user-1' }),
    touch: jest.fn(),
    getOwned: jest.fn(),
  },
  runs: {
    create: jest.fn().mockResolvedValue({ id: 'run-1' }),
    finish: jest.fn(),
  },
  approvals: { create: jest.fn().mockResolvedValue({ id: 'appr-1' }) },
});

describe('ChatStreamService.stream (new turn)', () => {
  it('streams text deltas, finishes the run, and emits done:succeeded', async () => {
    const { conversations, runs, approvals } = deps();
    const agent = {
      stream: jest.fn().mockResolvedValue(
        fakeOutput([
          { type: 'text-delta', runId: 'mr-1', payload: { text: 'Hi ' } },
          { type: 'text-delta', runId: 'mr-1', payload: { text: 'there' } },
        ]),
      ),
    };
    const mastra = { getAgent: () => agent };
    const s = sink();
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { message: 'hello' } as never,
      s as never,
    );
    expect(s.frames[0]).toContain('"type":"start"');
    expect(s.frames.join('')).toContain('"delta":"Hi "');
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'succeeded',
        model: 'test-model',
        latencyMs: expect.any(Number),
      }),
    );
    expect(s.frames.at(-1)).toContain('"status":"succeeded"');
    expect(conversations.touch).toHaveBeenCalledWith('conv-1');
  });

  it('on suspend, creates an approval and emits approval-required + done:awaiting_approval', async () => {
    const { conversations, runs, approvals } = deps();
    const agent = {
      stream: jest.fn().mockResolvedValue(
        fakeOutput(
          [
            {
              type: 'tool-call-approval',
              runId: 'mr-9',
              payload: {
                toolCallId: 'tc-1',
                toolName: 'send-email',
                args: { to: 'x@y.z' },
              },
            },
          ],
          'suspended',
        ),
      ),
    };
    const mastra = { getAgent: () => agent };
    const s = sink();
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { message: 'email x' } as never,
      s as never,
    );
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc-1',
        mastraRunId: 'mr-9',
        actionType: 'send_email',
        status: 'pending',
      }),
    );
    expect(s.frames.join('')).toContain('"type":"approval-required"');
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(s.frames.at(-1)).toContain('"status":"awaiting_approval"');
  });

  it('when conversations.ensure rejects, emits error + done:failed and never calls runs.finish (no run created)', async () => {
    const { conversations, runs, approvals } = deps();
    conversations.ensure.mockRejectedValue(new Error('not found'));
    const agent = { stream: jest.fn() };
    const mastra = { getAgent: () => agent };
    const s = sink();
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { conversationId: 'bad-conv', message: 'hello' } as never,
      s as never,
    );
    expect(s.frames.join('')).toContain('"type":"error"');
    expect(s.frames.join('')).toContain('"message":"not found"');
    expect(s.frames.at(-1)).toContain('"status":"failed"');
    expect(runs.finish).not.toHaveBeenCalled();
    expect(agent.stream).not.toHaveBeenCalled();
  });

  it('when agent.stream rejects, emits error + done:failed and finishes the already-created run as failed', async () => {
    const { conversations, runs, approvals } = deps();
    const agent = {
      stream: jest.fn().mockRejectedValue(new Error('agent unavailable')),
    };
    const mastra = { getAgent: () => agent };
    const s = sink();
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { message: 'hello' } as never,
      s as never,
    );
    expect(s.frames.join('')).toContain('"type":"error"');
    expect(s.frames.join('')).toContain('"message":"agent unavailable"');
    expect(s.frames.at(-1)).toContain('"status":"failed"');
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});

describe('ChatStreamService.stream (resume)', () => {
  it('approves, streams the continuation, and marks the approval executed', async () => {
    const conversations = {
      ensure: jest.fn(),
      touch: jest.fn(),
      getOwned: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', resourceId: 'user-1' }),
    };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue({
        id: 'appr-1',
        status: 'pending',
        conversationId: 'conv-1',
        runId: 'run-1',
        mastraRunId: 'mr-9',
        toolCallId: 'tc-1',
      }),
      decide: jest.fn().mockResolvedValue(undefined),
    };
    const agent = {
      approveToolCall: jest.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            runId: 'mr-9',
            payload: { text: 'sent!' },
          };
        })(),
        text: Promise.resolve('sent!'),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
        finishReason: Promise.resolve('stop'),
      }),
    };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      {
        conversationId: 'conv-1',
        resume: { approvalId: 'appr-1', approved: true },
      } as never,
      { write: (f: string) => frames.push(f) } as never,
    );
    expect(agent.approveToolCall).toHaveBeenCalledWith({
      runId: 'mr-9',
      toolCallId: 'tc-1',
    });
    expect(frames.join('')).toContain('"delta":"sent!"');
    expect(approvals.decide).toHaveBeenCalledWith(
      'appr-1',
      expect.objectContaining({ status: 'executed' }),
    );
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(frames.at(-1)).toContain('"status":"succeeded"');
  });

  it('when the approval is missing, emits error + done:failed and never calls the agent', async () => {
    const conversations = {
      ensure: jest.fn(),
      touch: jest.fn(),
      getOwned: jest.fn(),
    };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue(null),
      decide: jest.fn(),
      create: jest.fn(),
    };
    const agent = { approveToolCall: jest.fn(), declineToolCall: jest.fn() };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { resume: { approvalId: 'missing-appr', approved: true } } as never,
      { write: (f: string) => frames.push(f) } as never,
    );
    expect(frames.join('')).toContain('"type":"error"');
    expect(frames.at(-1)).toContain('"status":"failed"');
    expect(agent.approveToolCall).not.toHaveBeenCalled();
    expect(agent.declineToolCall).not.toHaveBeenCalled();
  });

  it('when the approval is already resolved (not pending), emits error + done:failed and never calls the agent', async () => {
    const conversations = {
      ensure: jest.fn(),
      touch: jest.fn(),
      getOwned: jest.fn(),
    };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue({ status: 'executed' }),
      decide: jest.fn(),
      create: jest.fn(),
    };
    const agent = { approveToolCall: jest.fn(), declineToolCall: jest.fn() };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { resume: { approvalId: 'appr-1', approved: true } } as never,
      { write: (f: string) => frames.push(f) } as never,
    );
    expect(frames.join('')).toContain('"type":"error"');
    expect(frames.at(-1)).toContain('"status":"failed"');
    expect(agent.approveToolCall).not.toHaveBeenCalled();
    expect(agent.declineToolCall).not.toHaveBeenCalled();
  });

  it('fails closed when a non-admin resumes a pending approval whose conversationId is null (never calls the agent)', async () => {
    const conversations = {
      ensure: jest.fn(),
      touch: jest.fn(),
      getOwned: jest.fn(),
    };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue({
        id: 'appr-1',
        status: 'pending',
        conversationId: null,
        runId: 'run-1',
        mastraRunId: 'mr-9',
        toolCallId: 'tc-1',
      }),
      decide: jest.fn(),
      create: jest.fn(),
    };
    const agent = { approveToolCall: jest.fn(), declineToolCall: jest.fn() };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      { resume: { approvalId: 'appr-1', approved: true } } as never,
      { write: (f: string) => frames.push(f) } as never,
    );
    expect(frames.join('')).toContain('"type":"error"');
    expect(frames.at(-1)).toContain('"status":"failed"');
    expect(conversations.getOwned).not.toHaveBeenCalled();
    expect(agent.approveToolCall).not.toHaveBeenCalled();
    expect(agent.declineToolCall).not.toHaveBeenCalled();
  });

  it('declines, streams the continuation, marks the approval rejected, and finishes the run as cancelled (with text/usage)', async () => {
    const conversations = {
      ensure: jest.fn(),
      touch: jest.fn(),
      getOwned: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', resourceId: 'user-1' }),
    };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue({
        id: 'appr-1',
        status: 'pending',
        conversationId: 'conv-1',
        runId: 'run-1',
        mastraRunId: 'mr-9',
        toolCallId: 'tc-1',
      }),
      decide: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
    };
    const agent = {
      approveToolCall: jest.fn(),
      declineToolCall: jest.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            runId: 'mr-9',
            payload: { text: 'okay, skipping' },
          };
        })(),
        text: Promise.resolve('okay, skipping'),
        usage: Promise.resolve({ inputTokens: 2, outputTokens: 4 }),
        finishReason: Promise.resolve('stop'),
      }),
    };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      {
        conversationId: 'conv-1',
        resume: { approvalId: 'appr-1', approved: false },
      } as never,
      { write: (f: string) => frames.push(f) } as never,
    );
    expect(agent.declineToolCall).toHaveBeenCalledWith({
      runId: 'mr-9',
      toolCallId: 'tc-1',
    });
    expect(approvals.decide).toHaveBeenCalledWith(
      'appr-1',
      expect.objectContaining({ status: 'rejected' }),
    );
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'cancelled',
        output: { text: 'okay, skipping' },
        tokensInput: 2,
        tokensOutput: 4,
      }),
    );
    expect(frames.at(-1)).toContain('"status":"cancelled"');
  });

  it('when a second approval surfaces during the continuation, records a new pending approval and pauses again without finishing the run', async () => {
    const conversations = {
      ensure: jest.fn(),
      touch: jest.fn(),
      getOwned: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', resourceId: 'user-1' }),
    };
    const runs = { create: jest.fn(), finish: jest.fn() };
    const approvals = {
      findById: jest.fn().mockResolvedValue({
        id: 'appr-1',
        status: 'pending',
        conversationId: 'conv-1',
        runId: 'run-1',
        mastraRunId: 'mr-9',
        toolCallId: 'tc-1',
      }),
      decide: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue({ id: 'appr-2' }),
    };
    const agent = {
      approveToolCall: jest.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield {
            type: 'tool-call-approval',
            runId: 'mr-2',
            payload: { toolCallId: 'tc-2', toolName: 'send-email', args: {} },
          };
        })(),
        text: Promise.resolve(''),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
        finishReason: Promise.resolve('suspended'),
      }),
      declineToolCall: jest.fn(),
    };
    const mastra = { getAgent: () => agent };
    const frames: string[] = [];
    const svc = new ChatStreamService(
      conversations as never,
      runs as never,
      approvals as never,
      mastra as never,
      config() as never,
    );
    await svc.stream(
      { kind: 'user', userId: 'user-1', role: 'user' },
      {
        conversationId: 'conv-1',
        resume: { approvalId: 'appr-1', approved: true },
      } as never,
      { write: (f: string) => frames.push(f) } as never,
    );
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        toolCallId: 'tc-2',
        mastraRunId: 'mr-2',
        actionType: 'send_email',
        status: 'pending',
      }),
    );
    expect(approvals.decide).toHaveBeenCalledWith(
      'appr-1',
      expect.objectContaining({ status: 'executed' }),
    );
    expect(frames.join('')).toContain('"type":"approval-required"');
    expect(frames.at(-1)).toContain('"status":"awaiting_approval"');
    expect(runs.finish).not.toHaveBeenCalled();
  });
});
