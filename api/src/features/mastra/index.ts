import { Mastra } from '@mastra/core';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../config/configurations/mastra.config';
import { buildOrchestratorAgent } from './agents/orchestrator.agent';
import { buildStore } from './memory/memory.factory';
import { AGENT_ID, SCHEDULED_REPORT_WORKFLOW_ID } from './mastra.constants';
import type { ToolServices } from './mastra.types';
import { buildScheduledReportWorkflow } from './workflows/scheduled-report.workflow';

export interface BuildMastraDeps {
  cfg: MastraConfig;
  pool: Pool;
  services: ToolServices;
  /** Test-only override so no live model call is made in integration. */
  modelOverride?: unknown;
}

/**
 * Assembles the app-lifetime `Mastra` instance: registers the orchestrator
 * agent and the scheduled-report workflow, and wires storage to the shared
 * Postgres pool (scoped to the `mastra` schema via `buildStore`) so both
 * conversation memory and workflow suspend/resume snapshots are durable.
 *
 * The `as never` cast on `storage` works around a dual-package hazard: this
 * repo's pnpm tree resolves two builds of `@mastra/core@1.50.1` (one peered
 * with zod@4.4.3, one with zod@3.25.76 — see `node_modules/.pnpm`), so the
 * `MastraCompositeStore` class `PostgresStore` (from `@mastra/pg`) extends is
 * not always nominally identical to the one `Mastra`'s `Config.storage` field
 * resolves against. Same pattern already used in `mastra-adapters.ts` /
 * `scheduled-report.workflow.ts` for the analogous hazard.
 */
export function buildMastra(deps: BuildMastraDeps): Mastra {
  const agent = buildOrchestratorAgent({
    cfg: deps.cfg,
    pool: deps.pool,
    services: deps.services,
    modelOverride: deps.modelOverride,
  });
  return new Mastra({
    storage: buildStore(deps.pool) as never,
    agents: { [AGENT_ID]: agent },
    workflows: {
      [SCHEDULED_REPORT_WORKFLOW_ID]: buildScheduledReportWorkflow(),
    },
  });
}
