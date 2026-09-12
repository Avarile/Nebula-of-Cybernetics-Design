import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MastraService } from '@mastra/nestjs';
import { withTimeout } from '../../../common/with-timeout';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { AGENT_ID } from '../mastra.constants';
import { userIdOrNull } from '../../../common/principal';
import type { PendingApproval, PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { ConversationService } from './conversation.service';
import {
  buildRequestContext,
  readMastraRunId,
  readUsage,
  toPendingApprovals,
} from './mastra-adapters';

export interface ChatInput {
  conversationId?: string;
  message: string;
}
export interface ChatResult {
  conversationId: string;
  runId: string;
  text: string;
  pendingApprovals: PendingApproval[];
}

/**
 * Orchestrates a single chat turn: resolve/create the conversation, invoke the
 * Mastra agent, ledger the run, persist any pending human-in-the-loop approvals,
 * and bump conversation activity. The only place Mastra's `generate()` result shape
 * leaks into is `mastra-adapters.ts` — this service reads only the adapters' output.
 */
@Injectable()
export class AgentRunnerService {
  /**
   * The configured model slug (e.g. `anthropic/claude-sonnet-4.6`). Used as the
   * ledger's `model` value because the AI Gateway provider does not return a
   * served model id on the result — see `mastra-adapters.ts::readUsage`.
   */
  private readonly configuredModel: string;
  /** How long a pending approval stays actionable (MASTRA_APPROVAL_TTL_MS). */
  private readonly approvalTtlMs: number;
  /** Ceiling on one buffered agent turn (MASTRA_RUN_TIMEOUT_MS). */
  private readonly runTimeoutMs: number;

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
    this.runTimeoutMs = cfg.runTimeoutMs;
  }

  async runChat(
    principal: PrincipalRef,
    input: ChatInput,
  ): Promise<ChatResult> {
    const conv = await this.conversations.ensure(
      principal,
      input.conversationId,
      'chat',
    );
    const run = await this.runs.create({
      conversationId: conv.id,
      trigger: 'user_message',
      triggeredByUserId: userIdOrNull(principal),
      status: 'running',
      agentId: AGENT_ID,
      input: { message: input.message },
      startedAt: new Date(),
    } as never);
    const startedAt = Date.now();
    try {
      const agent = this.mastra.getAgent(AGENT_ID);
      // Bounded. Without a deadline a slow or hung provider call held an HTTP
      // request open for as long as it liked, and MASTRA_MAX_RETRIES multiplied
      // it. The run is still ledgered as failed by the catch below.
      const result = await withTimeout(
        agent.generate(input.message, {
          memory: { resource: conv.resourceId, thread: { id: conv.id } },
          requestContext: buildRequestContext({
            principal,
            runId: run.id,
            conversationId: conv.id,
          }),
        } as never),
        this.runTimeoutMs,
      );

      const pending = toPendingApprovals(result);
      const usage = readUsage(result);
      for (const p of pending) {
        await this.approvals.create({
          runId: run.id,
          conversationId: conv.id,
          mastraRunId: readMastraRunId(result),
          toolCallId: p.toolCallId,
          actionType: p.actionType,
          title: p.title,
          payload: p.payload,
          status: 'pending',
          // Without this the `expired` status is unreachable and a pending
          // approval — a suspended run holding a workflow snapshot — lives
          // forever and stays approvable.
          expiresAt: new Date(Date.now() + this.approvalTtlMs),
        } as never);
      }
      await this.runs.finish(run.id, {
        status: pending.length ? 'awaiting_approval' : 'succeeded',
        output: { text: usage.text },
        model: usage.model ?? this.configuredModel,
        tokensInput: usage.tokensInput,
        tokensOutput: usage.tokensOutput,
        finishedAt: new Date(),
        latencyMs: Date.now() - startedAt,
      });
      await this.conversations.touch(conv.id);
      return {
        conversationId: conv.id,
        runId: run.id,
        text: usage.text,
        pendingApprovals: pending,
      };
    } catch (err) {
      await this.runs.finish(run.id, {
        status: 'failed',
        error: { message: err instanceof Error ? err.message : String(err) },
        finishedAt: new Date(),
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }
}
