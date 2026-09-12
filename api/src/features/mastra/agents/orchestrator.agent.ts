import { Agent } from '@mastra/core/agent';
import type { Pool } from 'pg';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { AGENT_ID } from '../mastra.constants';
import type { ToolServices } from '../mastra.types';
import { buildMemory } from '../memory/memory.factory';
import { buildModel } from '../memory/model.factory';
import { makeSearchDocumentsTool } from '../tools/search-documents.tool';
import { makeSearchQueryTool } from '../tools/search-query.tool';
import { makeSendEmailTool } from '../tools/send-email.tool';
import { ORCHESTRATOR_INSTRUCTIONS } from './prompts';

export interface BuildAgentParams {
  cfg: MastraConfig;
  pool: Pool;
  services: ToolServices;
  /** Test-only override so no live model call is made in integration. */
  modelOverride?: unknown;
}

export function buildOrchestratorAgent(params: BuildAgentParams): Agent {
  return new Agent({
    id: AGENT_ID,
    name: 'Orchestrator',
    instructions: ORCHESTRATOR_INSTRUCTIONS,
    model: (params.modelOverride ?? buildModel(params.cfg)) as never,
    /**
     * `calculate-metric` and `db-write` are deliberately NOT registered.
     *
     * Both were stubs presented to the model as working tools.
     * `calculate-metric` always returned `{ value: 0, unit: 'unknown' }` while
     * its description told the model it computed real business metrics, so the
     * agent would state a fabricated zero as fact. `db-write` recorded an audit
     * entry, returned `{ accepted: true }` and wrote nothing — after spending a
     * human approval. A model handed a tool will call it, so relabelling the
     * descriptions was not enough; the fix is not to offer them until they do
     * something. Their pure `*Execute` functions and tests remain for when a
     * domain exists to implement them against.
     */
    tools: {
      'search-query': makeSearchQueryTool(params.services),
      'search-documents': makeSearchDocumentsTool(params.services),
      'send-email': makeSendEmailTool(params.services),
    },
    memory: buildMemory(params.pool, params.cfg),
    maxRetries: params.cfg.maxRetries,
  });
}
