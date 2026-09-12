import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MastraService } from '@mastra/nestjs';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { AGENT_ID } from '../mastra.constants';
import { isAdmin, userIdOrNull } from '../../../common/principal';
import type { PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { buildRequestContext } from './mastra-adapters';
import { ConversationService } from './conversation.service';
import {
  actionTypeForTool,
  chunkToSse,
  sseFrame,
  type SseEvent,
} from './chunk-to-sse';

export interface StreamSink {
  write(frame: string): void;
}
interface StreamInput {
  conversationId?: string;
  message?: string;
  resume?: { approvalId: string; approved: boolean };
}
interface Suspend {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

@Injectable()
export class ChatStreamService {
  /**
   * The configured model slug. Ledgered on every `runs.finish` for parity with
   * the buffered `AgentRunnerService.runChat` — see `mastra-adapters.ts::readUsage`.
   */
  private readonly configuredModel: string;
  private readonly approvalTtlMs: number;

  constructor(
    private readonly conversations: ConversationService,
    private readonly runs: AgentRunRepository,
    private readonly approvals: ApprovalRepository,
    private readonly mastra: MastraService,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<MastraConfig>('mastra');
    this.configuredModel = cfg.model;
    this.approvalTtlMs = cfg.approvalTtlMs;
  }

  async stream(
    principal: PrincipalRef,
    input: StreamInput,
    sink: StreamSink,
  ): Promise<void> {
    const emit = (e: SseEvent) => sink.write(sseFrame(e));
    let run: Awaited<ReturnType<AgentRunRepository['create']>> | undefined;
    let startedAt = 0;

    try {
      if (input.resume) {
        await this.resume(principal, input.resume, sink);
        return;
      }
      const conv = await this.conversations.ensure(
        principal,
        input.conversationId,
        'chat',
      );
      run = await this.runs.create({
        conversationId: conv.id,
        trigger: 'user_message',
        triggeredByUserId: userIdOrNull(principal),
        status: 'running',
        agentId: AGENT_ID,
        input: { message: input.message },
        startedAt: new Date(),
      } as never);
      startedAt = Date.now();
      emit({ type: 'start', conversationId: conv.id, runId: run.id });

      const agent = this.mastra.getAgent(AGENT_ID);
      const output = await agent.stream(
        input.message as string,
        {
          memory: { resource: conv.resourceId, thread: { id: conv.id } },
          requestContext: buildRequestContext({
            principal,
            runId: run.id,
            conversationId: conv.id,
          }),
        } as never,
      );

      const { suspend, mastraRunId } = await this.pump(output as never, emit);
      await this.finishTurn(
        run.id,
        conv,
        output as never,
        suspend,
        mastraRunId,
        startedAt,
        emit,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (run) {
        await this.runs.finish(run.id, {
          status: 'failed',
          error: { message },
          model: this.configuredModel,
          latencyMs: Date.now() - startedAt,
          finishedAt: new Date(),
        } as never);
      }
      emit({ type: 'error', message });
      emit({ type: 'done', status: 'failed' });
    }
  }

  /** Consume the Mastra stream, forwarding client-facing chunks; capture suspend + runId. */
  private async pump(
    output: {
      fullStream: AsyncIterable<{
        type: string;
        runId?: string;
        payload?: Record<string, unknown>;
      }>;
    },
    emit: (e: SseEvent) => void,
  ): Promise<{ suspend: Suspend | null; mastraRunId: string | null }> {
    let suspend: Suspend | null = null;
    let mastraRunId: string | null = null;
    for await (const chunk of output.fullStream) {
      mastraRunId ??= chunk.runId ?? null;
      if (
        chunk.type === 'tool-call-approval' ||
        chunk.type === 'tool-call-suspended'
      ) {
        const p = chunk.payload ?? {};
        suspend = {
          toolCallId: String(p.toolCallId ?? ''),
          toolName: String(p.toolName ?? ''),
          args: (p.args as Record<string, unknown>) ?? {},
        };
        continue;
      }
      const event = chunkToSse(chunk);
      if (event) emit(event);
    }
    return { suspend, mastraRunId };
  }

  private async finishTurn(
    runId: string,
    conv: { id: string },
    output: {
      text: Promise<string>;
      usage: Promise<{ inputTokens?: number; outputTokens?: number }>;
      finishReason: Promise<string | undefined>;
    },
    suspend: Suspend | null,
    mastraRunId: string | null,
    startedAt: number,
    emit: (e: SseEvent) => void,
  ): Promise<void> {
    const reason = await output.finishReason;
    if (suspend || reason === 'suspended') {
      const s = suspend as Suspend;
      const appr = await this.approvals.create({
        runId,
        conversationId: conv.id,
        mastraRunId,
        toolCallId: s.toolCallId,
        actionType: actionTypeForTool(s.toolName),
        title: `Approve ${s.toolName}`,
        payload: s.args,
        status: 'pending',
        expiresAt: new Date(Date.now() + this.approvalTtlMs),
      } as never);
      await this.runs.finish(runId, {
        status: 'awaiting_approval',
        model: this.configuredModel,
        latencyMs: Date.now() - startedAt,
        finishedAt: new Date(),
      } as never);
      emit({
        type: 'approval-required',
        approvalId: appr.id,
        toolCallId: s.toolCallId,
        toolName: s.toolName,
        actionType: actionTypeForTool(s.toolName),
        title: `Approve ${s.toolName}`,
        payload: s.args,
      });
      emit({ type: 'done', status: 'awaiting_approval' });
      return;
    }
    const [text, usage] = await Promise.all([output.text, output.usage]);
    await this.runs.finish(runId, {
      status: 'succeeded',
      output: { text },
      model: this.configuredModel,
      tokensInput: usage.inputTokens,
      tokensOutput: usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      finishedAt: new Date(),
    } as never);
    await this.conversations.touch(conv.id);
    emit({ type: 'done', status: 'succeeded' });
  }

  /**
   * Resume a suspended stream-path run after a human approves/declines the
   * pending tool call. Self-contained: emits its own `start` and terminal
   * `done`, and never throws out to `stream()`'s catch (failures here are
   * recorded against the approval and reported via `error`+`done:failed`).
   */
  private async resume(
    principal: PrincipalRef,
    resume: { approvalId: string; approved: boolean },
    sink: StreamSink,
  ): Promise<void> {
    const emit = (e: SseEvent) => sink.write(sseFrame(e));
    const appr = await this.approvals.findById(resume.approvalId);
    if (!appr || appr.status !== 'pending') {
      emit({
        type: 'error',
        message: 'Approval not found or already resolved',
      });
      emit({ type: 'done', status: 'failed' });
      return;
    }
    if (!isAdmin(principal)) {
      if (!appr.conversationId) {
        emit({
          type: 'error',
          message: 'Not authorized to resume this approval',
        });
        emit({ type: 'done', status: 'failed' });
        return;
      }
      await this.conversations.getOwned(principal, appr.conversationId); // throws 403/404
    }
    emit({
      type: 'start',
      conversationId: appr.conversationId as string,
      runId: appr.runId,
    });
    const startedAt = Date.now();
    try {
      const agent = this.mastra.getAgent(AGENT_ID);
      const payload = {
        runId: appr.mastraRunId as string,
        toolCallId: appr.toolCallId ?? undefined,
      };
      const output = resume.approved
        ? await agent.approveToolCall(payload as never)
        : await agent.declineToolCall(payload as never);
      const { suspend, mastraRunId } = await this.pump(output as never, emit);

      if (suspend) {
        // A second approval surfaced during the continuation — record it and pause again.
        const next = await this.approvals.create({
          runId: appr.runId,
          conversationId: appr.conversationId,
          mastraRunId,
          toolCallId: suspend.toolCallId,
          actionType: actionTypeForTool(suspend.toolName),
          title: `Approve ${suspend.toolName}`,
          payload: suspend.args,
          status: 'pending',
        } as never);
        await this.approvals.decide(resume.approvalId, {
          status: resume.approved ? 'executed' : 'rejected',
          decidedByUserId: userIdOrNull(principal),
          decidedAt: new Date(),
        } as never);
        emit({
          type: 'approval-required',
          approvalId: next.id,
          toolCallId: suspend.toolCallId,
          toolName: suspend.toolName,
          actionType: actionTypeForTool(suspend.toolName),
          title: `Approve ${suspend.toolName}`,
          payload: suspend.args,
        });
        emit({ type: 'done', status: 'awaiting_approval' });
        return;
      }

      await this.approvals.decide(resume.approvalId, {
        status: resume.approved ? 'executed' : 'rejected',
        decidedByUserId: userIdOrNull(principal),
        decidedAt: new Date(),
      } as never);
      const [text, usage] = await Promise.all([output.text, output.usage]);
      await this.runs.finish(appr.runId, {
        status: resume.approved ? 'succeeded' : 'cancelled',
        output: { text },
        model: this.configuredModel,
        tokensInput: usage.inputTokens,
        tokensOutput: usage.outputTokens,
        latencyMs: Date.now() - startedAt,
        finishedAt: new Date(),
      } as never);
      emit({
        type: 'done',
        status: resume.approved ? 'succeeded' : 'cancelled',
      });
    } catch (err) {
      await this.approvals.decide(resume.approvalId, {
        status: 'failed',
        decidedByUserId: userIdOrNull(principal),
        decidedAt: new Date(),
        result: { error: err instanceof Error ? err.message : String(err) },
      } as never);
      emit({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      emit({ type: 'done', status: 'failed' });
    }
  }
}
