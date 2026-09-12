// `@mastra/nestjs`'s build pulls in Mastra's server/editor stack (ESM-only transitive
// deps), which breaks under Jest's default transformIgnorePatterns. `ApprovalService`
// only uses `MastraService` for its type (DI token) and calls `.getAgent(...)` on the
// injected instance, so stub the module rather than loading the real one.
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));

import {
  AppException,
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import { ApprovalService } from './approval.service';

/**
 * `agent` fixture mirrors the CONFIRMED real resume API (`node_modules/@mastra/core`
 * 1.50.1, `dist/agent/agent.d.ts` L1449-1472 + `dist/docs/references/docs-agents-agent-
 * approval.md` "Tool approval with `generate()`" + stream/generate comparison table):
 * since `AgentRunnerService` resumes via `generate()` (not `stream()`), the correct bind
 * is `approveToolCallGenerate` / `declineToolCallGenerate` — the non-streaming
 * counterparts of `approveToolCall` / `declineToolCall` — see `mastra-adapters.ts` for
 * the full citation.
 */
function make(appr: any) {
  const approvals = {
    findById: jest.fn(async () => appr),
    findPendingForOwner: jest.fn(async () => [appr]),
    decide: jest.fn(async () => undefined),
  };
  const runs = { finish: jest.fn(async () => undefined) };
  const agent = {
    approveToolCallGenerate: jest.fn(async () => undefined),
    declineToolCallGenerate: jest.fn(async () => undefined),
  };
  const mastra = { getAgent: jest.fn(() => agent) };
  const conversations = {
    getOwned: jest.fn(async () => ({
      id: appr.conversationId,
      ownerUserId: 'u1',
    })),
  };
  return {
    service: new ApprovalService(
      approvals as never,
      runs as never,
      mastra as never,
      conversations as never,
      new ExceptionService(),
    ),
    approvals,
    runs,
    agent,
    conversations,
  };
}

describe('ApprovalService.decide', () => {
  const appr = {
    id: 'a1',
    runId: 'r1',
    mastraRunId: 'mr1',
    toolCallId: 'tc1',
    status: 'pending',
  };

  it('approves: resumes the tool call and marks executed', async () => {
    const { service, approvals, agent } = make(appr);
    await service.decide({ kind: 'user', userId: 'u1', role: 'admin' }, 'a1', {
      approved: true,
    });
    expect(agent.approveToolCallGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'mr1', toolCallId: 'tc1' }),
    );
    expect(approvals.decide).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'executed' }),
    );
  });

  it('rejects: declines and marks rejected', async () => {
    const { service, agent, approvals } = make(appr);
    await service.decide({ kind: 'user', userId: 'u1', role: 'admin' }, 'a1', {
      approved: false,
      note: 'no',
    });
    expect(agent.declineToolCallGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'mr1', toolCallId: 'tc1' }),
    );
    expect(approvals.decide).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'rejected' }),
    );
  });

  it('409s when the approval is not pending', async () => {
    const { service } = make({ ...appr, status: 'executed' });
    await expect(
      service.decide({ kind: 'user', userId: 'u1', role: 'admin' }, 'a1', {
        approved: true,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.AGENT_APPROVAL_CONFLICT,
      message: 'Approval already decided',
    });
  });

  it("403s and never resumes when a non-owner, non-admin caller decides someone else's approval", async () => {
    const { service, agent, approvals, conversations } = make({
      ...appr,
      conversationId: 'conv-1',
    });
    conversations.getOwned.mockRejectedValueOnce(
      new AppException(ErrorCode.FORBIDDEN, {
        message: 'Not your conversation',
      }),
    );

    await expect(
      service.decide({ kind: 'user', userId: 'u2', role: 'user' }, 'a1', {
        approved: true,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Not your conversation',
    });

    expect(conversations.getOwned).toHaveBeenCalledWith(
      { kind: 'user', userId: 'u2', role: 'user' },
      'conv-1',
    );
    expect(agent.approveToolCallGenerate).not.toHaveBeenCalled();
    expect(approvals.decide).not.toHaveBeenCalled();
  });

  it('403s a non-admin caller when the approval has no conversationId to check ownership against', async () => {
    const { service, agent, approvals } = make({
      ...appr,
      conversationId: null,
    });

    await expect(
      service.decide({ kind: 'user', userId: 'u2', role: 'user' }, 'a1', {
        approved: true,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.AGENT_APPROVAL_FORBIDDEN,
      message: 'Not your approval',
    });

    expect(agent.approveToolCallGenerate).not.toHaveBeenCalled();
    expect(approvals.decide).not.toHaveBeenCalled();
  });
});
