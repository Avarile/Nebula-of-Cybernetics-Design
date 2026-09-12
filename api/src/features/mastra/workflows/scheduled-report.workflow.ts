import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { AGENT_ID, SCHEDULED_REPORT_WORKFLOW_ID } from '../mastra.constants';
import { AgentReportSchema } from '../mastra.types';

const inputSchema = z.object({
  scheduleId: z.string(),
  userId: z.string().nullable().optional(),
  promptTemplate: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  deliveryChannel: z
    .enum(['conversation', 'email', 'none'])
    .default('conversation'),
  deliveryTarget: z.string().nullable().optional(),
});

/**
 * Confirmed against the installed `@mastra/core@1.50.1` types
 * (`node_modules/@mastra/core/dist/workflows/*.d.ts`):
 * - `createWorkflow({ id, inputSchema, outputSchema, retryConfig })` and
 *   `createStep({ id, inputSchema, outputSchema, resumeSchema?, suspendSchema?,
 *   execute })` option names match the brief verbatim (`workflow.d.ts` L150
 *   constructor destructuring; `step.d.ts` L59-77 `Step` interface;
 *   `types.d.ts` L525 `StepParams`).
 * - `.then(step)` / `.commit()` chaining confirmed (`workflow.d.ts` L166,
 *   L226).
 * - Step `execute` params destructure real names off `ExecuteFunctionParams`
 *   (`step.d.ts` L20-52): `mastra: Mastra`, `inputData: TStepInput`,
 *   `resumeData?: TResume`, `suspend: (suspendPayload, suspendOptions?) =>
 *   InnerOutput | Promise<InnerOutput>` — exactly the names/shapes the brief
 *   destructures, no adaptation needed.
 * - `agent.generate(prompt, { structuredOutput: { schema } })` resolves to
 *   `FullOutput<OUTPUT>` (`dist/stream/base/output.d.ts` L26-58), which has a
 *   real `object: OUTPUT` field (L58) — matching `mastra-adapters.ts`'s own
 *   confirmed doc comment that `generate()` resolves to `FullOutput`. The
 *   `.object` accessor in the brief is correct as written.
 * - Casts kept from the brief: `structuredOutput` options and the `.object`
 *   read both go through `as never` / `as { object: unknown }` casts, the
 *   same pattern already used in `services/agent-runner.service.ts` for
 *   `agent.generate(...)` calls — `Mastra`'s `getAgent`/`Agent.generate`
 *   overload set does not narrow cleanly through the workflow step's untyped
 *   `mastra: Mastra` parameter, so the cast avoids a deep generic mismatch
 *   without weakening anything outside this one call site. No zod
 *   version-mismatch cast was needed: `@mastra/core` resolves (via pnpm) to
 *   the `zod@3.25.76`-peered build of `@mastra/schema-compat`, the same zod
 *   installed tree-wide, so `AgentReportSchema` (zod v3.25) satisfies
 *   `PublicSchema`/`StandardSchemaWithJSON` directly.
 */
export function buildScheduledReportWorkflow() {
  const analyze = createStep({
    id: 'analyze',
    inputSchema,
    outputSchema: z.object({
      report: AgentReportSchema,
      deliveryChannel: inputSchema.shape.deliveryChannel,
      deliveryTarget: z.string().nullable().optional(),
    }),
    execute: async ({ inputData, mastra }) => {
      const agent = mastra.getAgent(AGENT_ID);
      const res = await agent.generate(inputData.promptTemplate, {
        structuredOutput: { schema: AgentReportSchema },
      } as never);
      return {
        report: (res as { object: unknown }).object as never,
        deliveryChannel: inputData.deliveryChannel,
        deliveryTarget: inputData.deliveryTarget,
      };
    },
  });

  const deliver = createStep({
    id: 'deliver',
    inputSchema: analyze.outputSchema,
    outputSchema: z.object({ delivered: z.boolean() }),
    /**
     * Delivery is NOT implemented, and this step says so rather than lying.
     *
     * `conversation` used to return `{ delivered: true }` while nothing wrote
     * the report anywhere — the comment claimed "the processor persists the
     * report into the conversation", and `AgentRunProcessor` never touched a
     * conversation. `email` suspended for an approval that nothing could ever
     * resume. Both paths reported the run as succeeded.
     *
     * Reporting a delivery that did not happen is worse than failing, so an
     * undeliverable channel now fails loudly. `none` is the one honest option
     * and still succeeds: the report lands in `agent_run.output`, which is
     * where a caller can actually read it today.
     */
    execute: async ({ inputData }) => {
      if (inputData.deliveryChannel === 'none') return { delivered: false };
      throw new Error(
        `Delivery channel "${inputData.deliveryChannel}" is not implemented. ` +
          `The report is available on the agent_run row; set deliveryChannel ` +
          `to "none" to acknowledge that, or implement delivery before using ` +
          `this schedule.`,
      );
    },
  });

  return createWorkflow({
    id: SCHEDULED_REPORT_WORKFLOW_ID,
    inputSchema,
    outputSchema: z.object({ delivered: z.boolean() }),
    retryConfig: { attempts: 2, delay: 2000 },
  })
    .then(analyze)
    .then(deliver)
    .commit();
}
