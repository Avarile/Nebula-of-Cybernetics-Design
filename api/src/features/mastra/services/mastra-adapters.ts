import { RequestContext } from '@mastra/core/request-context';
import { REQUEST_CTX } from '../mastra.constants';
import type { PendingApproval, ToolRuntime } from '../mastra.types';

/**
 * Build the per-call requestContext Mastra passes to tools.
 *
 * Confirmed against `node_modules/@mastra/core/dist/agent/agent.types.d.ts`
 * (`AgentExecutionOptionsBase.requestContext?: RequestContext<any>`): the option is
 * typed as Mastra's `RequestContext` **class**, not a plain object — a plain
 * `Record` would satisfy `unknown`-typed call sites but Mastra internals (and our own
 * `tools/tool-context.ts::readRuntime`) call `.get(key)` on it, which a plain object
 * doesn't support. `RequestContext`'s constructor accepts an iterable of `[key, value]`
 * tuples (`dist/_types/@internal_core/dist/request-context/index.d.ts`); confirmed
 * loadable under CJS/Jest with no ESM-only transitive deps (unlike `@mastra/core/tools`,
 * which pulls in `@sindresorhus/slugify`).
 */
export function buildRequestContext(rt: ToolRuntime): RequestContext {
  return new RequestContext([
    [REQUEST_CTX.principal, rt.principal],
    [REQUEST_CTX.runId, rt.runId],
    [REQUEST_CTX.conversationId, rt.conversationId],
  ]);
}

/**
 * Map a `generate()` result to our pending-approval list.
 *
 * Confirmed shape (`@mastra/core` 1.50.1):
 * - `dist/docs/references/docs-agents-agent-approval.md` ("Tool approval with
 *   generate()"): "When a tool requires approval, `generate()` returns immediately with
 *   `finishReason: 'suspended'`, a `suspendPayload` containing the tool call details
 *   (`toolCallId`, `toolName`, `args`), and a `runId`."
 * - `suspendPayload` is a SINGLE object, not an array: `toolCallConcurrency` defaults to
 *   1 "when approval may be required" (`dist/agent/agent.types.d.ts` doc comment on
 *   `toolCallConcurrency`), so at most one tool call is ever pending per `generate()`
 *   call. Both our tools that require approval (`send-email`, `db-write`) set
 *   `requireApproval: true` at the tool definition, which is one of the two flags
 *   (OR'd with `requireToolApproval` on the call) that triggers this suspension.
 * - The result's own typed field is `suspendPayload: any` (`dist/stream/base/output.d.ts`
 *   `PromiseResults`); the concrete `{ toolCallId, toolName, args }` shape is documented,
 *   not typed, so we narrow it defensively here.
 */
export function toPendingApprovals(result: unknown): PendingApproval[] {
  const r = result as {
    finishReason?: string;
    suspendPayload?: {
      toolCallId: string;
      toolName: string;
      args?: Record<string, unknown>;
    };
  };
  if (r.finishReason !== 'suspended' || !r.suspendPayload) return [];
  const { toolCallId, toolName, args } = r.suspendPayload;
  const typeByTool: Record<string, PendingApproval['actionType']> = {
    'send-email': 'send_email',
    'db-write': 'db_write',
  };
  return [
    {
      toolCallId,
      actionType: typeByTool[toolName] ?? 'other',
      title: `Approve ${toolName}`,
      payload: args ?? {},
    },
  ];
}

/**
 * Read text + token usage off a `generate()` result.
 *
 * Confirmed shape: `Agent.generate()` resolves to `FullOutput<T>`
 * (`dist/stream/base/output.d.ts`), a plain resolved object (not a stream — `text`,
 * `usage`, `totalUsage`, `response`, `finishReason`, `runId`, `suspendPayload` are all
 * already-resolved values, unlike `MastraModelOutput`'s promise-returning getters used by
 * `stream()`).
 * - `text: string` — resolved text output across all (non-rejected) steps.
 * - `usage`/`totalUsage: LanguageModelUsage` (`dist/stream/types.d.ts`, extending
 *   `LanguageModelV2Usage`) both expose `inputTokens`/`outputTokens` — matching the
 *   originally-guessed field names. `usage` is "Token usage for the last step" per the
 *   `FullOutput` doc comment, while `totalUsage` is the aggregate across every step in
 *   the turn (relevant when the agent loops through tool calls before finishing); we bind
 *   to `totalUsage` (falling back to `usage`) so the run ledger reflects the whole turn.
 * - `model` is NOT a top-level `FullOutput` field. It is documented to live at
 *   `response.modelId` (`LLMStepResult['response']`, `dist/stream/types.d.ts` ~L1148-1159),
 *   but EMPIRICALLY the Vercel AI Gateway provider (`@ai-sdk/gateway@4.0.20`) leaves it
 *   BLANK: top-level `response` carries no `modelId`, and the per-step
 *   `steps[i].response.modelId` is an empty string `''`. So there is no reliable served
 *   model id on the result today. We still read it defensively (top-level, then last step,
 *   coercing `''` → null) so this survives a future provider that DOES populate it, and the
 *   caller (`AgentRunnerService`) falls back to the configured model slug when it is null.
 */
export function readUsage(result: unknown): {
  model: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  text: string;
} {
  const r = result as {
    text?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    totalUsage?: { inputTokens?: number; outputTokens?: number };
    response?: { modelId?: string };
    steps?: Array<{ response?: { modelId?: string } }>;
  };
  const usage = r.totalUsage ?? r.usage;
  const stepModel = r.steps?.[r.steps.length - 1]?.response?.modelId;
  const model = (r.response?.modelId || stepModel || '').trim() || null;
  return {
    model,
    tokensInput: usage?.inputTokens ?? null,
    tokensOutput: usage?.outputTokens ?? null,
    text: r.text ?? '',
  };
}

/**
 * Read the Mastra-side run id off a `generate()` result.
 *
 * `FullOutput.runId` is a real, documented field (see the `readUsage`/
 * `toPendingApprovals` citations above), but its presence isn't reflected in a
 * shared type here, so call sites narrow it defensively. Centralizing that
 * narrowing keeps the "result shape" cast confined to this adapter module
 * instead of leaking into services (e.g. `AgentRunnerService`).
 */
export function readMastraRunId(result: unknown): string | null {
  return (result as { runId?: string }).runId ?? null;
}

/**
 * Resume a suspended `generate()` call after a human approves or declines the
 * pending tool call.
 *
 * Confirmed against `node_modules/@mastra/core` 1.50.1
 * `dist/agent/agent.d.ts` (L1377-1472) and
 * `dist/docs/references/docs-agents-agent-approval.md` ("Tool approval with
 * `generate()`" section + the stream/generate comparison table):
 * - `Agent` exposes FOUR resume methods, split by call style: `approveToolCall`
 *   / `declineToolCall` resume a suspended `stream()` and return a
 *   `MastraModelOutput` you must iterate (`Promise<MastraModelOutput<OUTPUT>>`,
 *   `agent.d.ts` L1392, L1429). `approveToolCallGenerate` /
 *   `declineToolCallGenerate` resume a suspended `generate()` and resolve
 *   directly to the finished result (`Awaited<ReturnType<MastraModelOutput<OUTPUT
 *   >['getFullOutput']>>`, `agent.d.ts` L1449-1472) — the same `FullOutput`
 *   shape `readUsage`/`toPendingApprovals` already read above.
 * - `AgentRunnerService.runChat` calls `agent.generate(...)` (not `stream()`),
 *   so the correct bind here is `approveToolCallGenerate` /
 *   `declineToolCallGenerate`, NOT the guessed `approveToolCall` /
 *   `declineToolCall` — those are the streaming counterparts and would return
 *   an unconsumed stream instead of resolving.
 * - Both `*Generate` methods take `{ runId: string; toolCallId?: string }`
 *   (`agent.d.ts` L1449-1451, L1469-1471). `toolCallId` is optional — "When
 *   omitted, the agent resumes the most recent suspended tool call" (approval
 *   doc, stream/generate comparison table note) — but we always have it from
 *   the stored `agent_approval` row, so we pass it to disambiguate.
 * - No `memory`/`resource`+`thread` context is required: the "Resuming after a
 *   restart" example (approval doc) rediscovers and resumes a suspended run
 *   using only `runId` (+ optional `toolCallId`) with no `memory` option
 *   passed — the run's persisted snapshot, keyed by `runId`, already carries
 *   the thread/resource context needed to resume. `memory` is optional on
 *   `AgentExecutionOptionsBase` (`agent.types.d.ts` L400), which both
 *   `*Generate` methods extend. Confirmed: `ApprovalService` does NOT need a
 *   `ConversationRepository` dependency for this call.
 */
export async function resumeAfterApproval(
  agent: {
    approveToolCallGenerate: (args: {
      runId: string;
      toolCallId?: string;
    }) => Promise<unknown>;
    declineToolCallGenerate: (args: {
      runId: string;
      toolCallId?: string;
    }) => Promise<unknown>;
  },
  args: {
    mastraRunId: string | null;
    toolCallId: string | null;
    approved: boolean;
  },
): Promise<void> {
  if (!args.mastraRunId) {
    throw new Error(
      'resumeAfterApproval requires a mastraRunId on the approval row',
    );
  }
  const payload = {
    runId: args.mastraRunId,
    toolCallId: args.toolCallId ?? undefined,
  };
  if (args.approved) await agent.approveToolCallGenerate(payload);
  else await agent.declineToolCallGenerate(payload);
}
