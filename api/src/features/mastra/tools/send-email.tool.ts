import { createTool } from '@mastra/core/tools';
import { userIdOrNull } from '../../../common/principal';
import { z } from 'zod';
import type { ToolRuntime, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const sendEmailInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  cc: z.string().email().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailInput>;

/** Pure logic — unit tested. Executes ONLY after human approval (requireApproval gates it). */
export async function sendEmailExecute(
  input: SendEmailInput,
  deps: Pick<ToolServices, 'sendEmail' | 'recordAction'>,
  rt: ToolRuntime,
): Promise<{ sent: true }> {
  try {
    await deps.sendEmail({
      to: input.to,
      subject: input.subject,
      text: input.body,
      cc: input.cc,
    });
    await deps.recordAction({
      runId: rt.runId,
      conversationId: rt.conversationId,
      actorUserId: userIdOrNull(rt.principal),
      actionType: 'send_email',
      toolId: 'send-email',
      status: 'success',
      summary: `Sent email to ${input.to}: ${input.subject}`,
      detail: { to: input.to, cc: input.cc },
    });
    return { sent: true };
  } catch (err) {
    await deps.recordAction({
      runId: rt.runId,
      conversationId: rt.conversationId,
      actorUserId: userIdOrNull(rt.principal),
      actionType: 'send_email',
      toolId: 'send-email',
      status: 'failed',
      summary: `Failed to email ${input.to}`,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/** Mastra wrapper — not unit tested (imports @mastra). Real side-effect: gated by requireApproval. */
export function makeSendEmailTool(services: ToolServices) {
  return createTool({
    id: 'send-email',
    description:
      'Send an email. Performs a real, external side-effect and REQUIRES human approval before it runs.',
    inputSchema: sendEmailInput,
    outputSchema: z.object({ sent: z.literal(true) }),
    requireApproval: true,
    execute: async (input: SendEmailInput, context: unknown) =>
      sendEmailExecute(input, services, readRuntime(context)),
  });
}
