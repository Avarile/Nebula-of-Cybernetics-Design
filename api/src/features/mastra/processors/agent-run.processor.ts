import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import type { Job } from 'bullmq';
import { SYSTEM_PRINCIPAL } from '../../../common/principal';
import {
  AGENT_RUN_QUEUE,
  EXPIRE_APPROVALS_JOB,
  RUN_SCHEDULE_JOB,
  SCHEDULED_REPORT_WORKFLOW_ID,
} from '../mastra.constants';
import { ScheduleRepository } from '../repositories/schedule.repository';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { buildRequestContext } from '../services/mastra-adapters';
import { haltWorkerIfApiOnly } from '../../../infrastructure/queue/worker-role';

/**
 * Consumes `run-schedule` jobs off `AGENT_RUN_QUEUE`: loads the live schedule,
 * ledgers an `agent_run` row, runs the scheduled-report workflow, and stamps
 * the outcome back onto both the run and the schedule.
 *
 * CONFIRMED against installed types (`node_modules/@mastra/nestjs/dist/mastra.service.d.ts`
 * L45 `getWorkflow(workflowId: string): AnyWorkflow`; `node_modules/@mastra/core/dist/
 * workflows/workflow.d.ts` L237 `createRun(options?): Promise<Run<...>>` and L320
 * `readonly runId: string` on `Run`, L431 `start(args: { inputData, ... }):
 * Promise<WorkflowResult<...>>`): `getWorkflow` / `createRun` / `start({ inputData })`
 * and `runHandle.runId` are all real, non-cast APIs — matches the brief as written.
 *
 * `WorkflowResult['status']` (`workflows/types.d.ts` L569-635) is a discriminated
 * union with FIVE members: `'success' | 'failed' | 'tripwire' | 'suspended' |
 * 'paused'`. `.start()` resolves (rather than rejects) for all of them, so a
 * resolved promise must NOT be treated as "succeeded" without checking `status` —
 * `'suspended'` in particular means the scheduled-report workflow paused on its
 * external-email approval step and did nothing yet.
 *
 * `Run.start(args)` (`workflow.d.ts` L431-441) accepts an optional
 * `requestContext?: RequestContext<TRequestContext>` — the same option
 * `AgentRunnerService.runChat` passes via `buildRequestContext`. We thread the
 * `SYSTEM_PRINCIPAL` + the ledgered `run.id` through here so scheduled runs carry
 * identity too (tools reading `ToolRuntime` off the request context, e.g. the
 * null-runId guard in `ActionLogRepository.record`, see it instead of nothing).
 */
@Processor(AGENT_RUN_QUEUE)
export class AgentRunProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AgentRunProcessor.name);

  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly runs: AgentRunRepository,
    private readonly approvals: ApprovalRepository,
    private readonly mastra: MastraService,
  ) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(job: Job): Promise<void> {
    if (job.name === EXPIRE_APPROVALS_JOB) {
      const expired = await this.approvals.expireOverdue();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} overdue approval(s)`);
      }
      return;
    }
    if (job.name !== RUN_SCHEDULE_JOB) return;
    const schedule = await this.schedules.findLiveById(
      job.data.scheduleId as string,
    );
    if (!schedule || !schedule.enabled) return;
    const run = await this.runs.create({
      trigger: 'schedule',
      status: 'running',
      agentId: schedule.agentId,
      input: { scheduleId: schedule.id },
      startedAt: new Date(),
    } as never);
    // Execution-only try/catch: this is the SOLE handler for a thrown execution
    // error (e.g. `createRun`/`start` rejecting outright). It must not wrap the
    // status switch below — the `'failed'`/default branches there also finish
    // the run + stamp the schedule and then `throw` (to trigger a BullMQ retry),
    // and if that throw were caught here too, `finish`/`stampRun` would each run
    // a second time for the same failure.
    const wf = this.mastra.getWorkflow(SCHEDULED_REPORT_WORKFLOW_ID);
    let runHandle: Awaited<ReturnType<typeof wf.createRun>>;
    let result: Awaited<ReturnType<typeof runHandle.start>>;
    try {
      runHandle = await wf.createRun();
      result = await runHandle.start({
        inputData: {
          scheduleId: schedule.id,
          userId: schedule.targetUserId ?? null,
          promptTemplate: schedule.promptTemplate,
          params: schedule.params,
          deliveryChannel: schedule.deliveryChannel,
          deliveryTarget: schedule.deliveryTarget,
        },
        requestContext: buildRequestContext({
          principal: SYSTEM_PRINCIPAL,
          runId: run.id,
          conversationId: null,
        }),
      } as never);
    } catch (err) {
      await this.runs.finish(run.id, {
        status: 'failed',
        error: { message: err instanceof Error ? err.message : String(err) },
        finishedAt: new Date(),
      });
      await this.schedules.stampRun(schedule.id, 'failed', run.id);
      throw err; // let BullMQ retry
    }

    const status = (result as { status?: string }).status;
    switch (status) {
      case 'success': {
        await this.runs.finish(run.id, {
          status: 'succeeded',
          output: result as never,
          mastraRunId: runHandle.runId ?? null,
          finishedAt: new Date(),
        });
        await this.schedules.stampRun(schedule.id, 'succeeded', run.id);
        return;
      }
      case 'suspended': {
        this.logger.warn(
          `Scheduled run ${runHandle.runId} (schedule ${schedule.id}) suspended ` +
            'awaiting human approval; resuming a scheduled workflow run via the ' +
            'external-email approval flow is deferred to v2, so this run is ' +
            'recorded as awaiting_approval, NOT succeeded.',
        );
        await this.runs.finish(run.id, {
          status: 'awaiting_approval',
          output: result as never,
          mastraRunId: runHandle.runId ?? null,
          finishedAt: new Date(),
        });
        await this.schedules.stampRun(schedule.id, 'suspended', run.id);
        return;
      }
      case 'failed': {
        const resultError = (result as { error?: unknown }).error;
        await this.runs.finish(run.id, {
          status: 'failed',
          error: {
            message:
              resultError instanceof Error
                ? resultError.message
                : String(resultError),
          },
          output: result as never,
          mastraRunId: runHandle.runId ?? null,
          finishedAt: new Date(),
        });
        await this.schedules.stampRun(schedule.id, 'failed', run.id);
        // Not caught by the try/catch above (it's outside that block), so this
        // propagates straight out of `process()` without re-triggering finish/
        // stampRun — it only triggers BullMQ's retry.
        throw resultError instanceof Error
          ? resultError
          : new Error(String(resultError));
      }
      default: {
        // 'tripwire' | 'paused' (or anything future): the scheduled-report
        // workflow doesn't use scorers or step-level pausing today, so these
        // aren't expected in practice — but treat conservatively as a failure
        // rather than silently reporting success.
        this.logger.warn(
          `Scheduled run ${runHandle.runId} (schedule ${schedule.id}) resolved ` +
            `with unexpected status "${String(status)}"; marking failed.`,
        );
        const message = `Unexpected workflow result status: ${String(status)}`;
        await this.runs.finish(run.id, {
          status: 'failed',
          error: { message },
          output: result as never,
          mastraRunId: runHandle.runId ?? null,
          finishedAt: new Date(),
        });
        await this.schedules.stampRun(schedule.id, 'failed', run.id);
        throw new Error(message);
      }
    }
  }
}
