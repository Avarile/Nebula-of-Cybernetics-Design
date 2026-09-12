import type { ActionType } from '../mastra.types';

export type SseEvent =
  | { type: 'start'; conversationId: string; runId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-input'; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool-output';
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: 'approval-required';
      approvalId: string;
      toolCallId: string;
      toolName: string;
      actionType: ActionType;
      title: string;
      payload: Record<string, unknown>;
    }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      status: 'succeeded' | 'awaiting_approval' | 'cancelled' | 'failed';
    };

/** Map one Mastra fullStream chunk to a client SSE event (or null to drop it). */
export function chunkToSse(chunk: {
  type: string;
  payload?: Record<string, unknown>;
}): SseEvent | null {
  const p = chunk.payload ?? {};
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text-delta', delta: String(p.text ?? '') };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', delta: String(p.text ?? '') };
    case 'tool-call':
      return {
        type: 'tool-input',
        toolCallId: String(p.toolCallId ?? ''),
        toolName: String(p.toolName ?? ''),
        args: p.args,
      };
    case 'tool-result':
      return {
        type: 'tool-output',
        toolCallId: String(p.toolCallId ?? ''),
        toolName: String(p.toolName ?? ''),
        result: p.result,
        isError: Boolean(p.isError),
      };
    case 'error':
      return {
        type: 'error',
        message:
          p.error instanceof Error
            ? p.error.message
            : String(p.error ?? 'stream error'),
      };
    default:
      return null; // start/step-*/finish/tool-call-approval handled by the service, not streamed verbatim
  }
}

export function sseFrame(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const ACTION_BY_TOOL: Record<string, ActionType> = {
  'send-email': 'send_email',
  'db-write': 'db_write',
};
export function actionTypeForTool(toolName: string): ActionType {
  return ACTION_BY_TOOL[toolName] ?? 'other';
}
