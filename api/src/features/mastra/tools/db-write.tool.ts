import { createTool } from '@mastra/core/tools';
import { userIdOrNull } from '../../../common/principal';
import { z } from 'zod';
import type { ToolRuntime, ToolServices } from '../mastra.types';
import { readRuntime } from './tool-context';

export const dbWriteInput = z.object({
  entity: z.string().min(1),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.record(z.string(), z.unknown()),
  targetId: z.string().optional(),
});
export type DbWriteInput = z.infer<typeof dbWriteInput>;

/**
 * Pure logic — unit tested. Reusable guarded write pattern; REQUIRES approval.
 * v1 has no concrete domain to write, so it validates + records the intended write.
 * Wire concrete repositories here (behind this signature) when the domain lands.
 */
export async function dbWriteExecute(
  input: DbWriteInput,
  deps: Pick<ToolServices, 'recordAction'>,
  rt: ToolRuntime,
): Promise<{ accepted: true }> {
  await deps.recordAction({
    runId: rt.runId,
    conversationId: rt.conversationId,
    actorUserId: userIdOrNull(rt.principal),
    actionType: 'db_write',
    toolId: 'db-write',
    status: 'success',
    summary: `${input.operation} ${input.entity}${input.targetId ? ` #${input.targetId}` : ''}`,
    detail: {
      entity: input.entity,
      operation: input.operation,
      targetId: input.targetId,
    },
  });
  return { accepted: true };
}

/** Mastra wrapper — not unit tested (imports @mastra). Real side-effect: gated by requireApproval. */
export function makeDbWriteTool(services: ToolServices) {
  return createTool({
    id: 'db-write',
    description:
      'Create/update/delete a domain record. Performs a real data side-effect and REQUIRES human approval before it runs.',
    inputSchema: dbWriteInput,
    outputSchema: z.object({ accepted: z.literal(true) }),
    requireApproval: true,
    execute: async (input: DbWriteInput, context: unknown) =>
      dbWriteExecute(input, services, readRuntime(context)),
  });
}
