import { ErrorCode } from '../error-codes';
import { isMastraError, mapMastraError } from './mastra-error.mapper';

function mastra(domain: string, category: string, id = 'X_FAILED') {
  return Object.assign(new Error('mastra boom'), {
    id,
    domain,
    category,
    details: { runId: 'r1' },
  });
}

describe('mastra-error.mapper', () => {
  it('detects Mastra-shaped errors and ignores plain errors', () => {
    expect(isMastraError(mastra('LLM', 'THIRD_PARTY'))).toBe(true);
    expect(isMastraError(new Error('plain'))).toBe(false);
    expect(isMastraError({})).toBe(false);
  });

  it.each([
    ['USER', 'TOOL', ErrorCode.AGENT_REQUEST_INVALID],
    ['USER', 'LLM', ErrorCode.AGENT_REQUEST_INVALID],
    ['THIRD_PARTY', 'LLM', ErrorCode.LLM_PROVIDER_ERROR],
    ['THIRD_PARTY', 'MODEL_ROUTER', ErrorCode.LLM_PROVIDER_ERROR],
    ['THIRD_PARTY', 'STORAGE', ErrorCode.DEPENDENCY_UNAVAILABLE],
    ['THIRD_PARTY', 'MASTRA_MEMORY', ErrorCode.DEPENDENCY_UNAVAILABLE],
    ['THIRD_PARTY', 'MASTRA_VECTOR', ErrorCode.DEPENDENCY_UNAVAILABLE],
    ['SYSTEM', 'TOOL', ErrorCode.TOOL_EXECUTION_FAILED],
    ['SYSTEM', 'MCP', ErrorCode.TOOL_EXECUTION_FAILED],
    ['SYSTEM', 'AGENT', ErrorCode.AGENT_RUN_FAILED],
    ['UNKNOWN', 'MASTRA_WORKFLOW', ErrorCode.AGENT_RUN_FAILED],
    ['UNKNOWN', 'MCP', ErrorCode.TOOL_EXECUTION_FAILED],
  ])('maps category=%s domain=%s to %s', (category, domain, expected) => {
    const err = mapMastraError(mastra(domain, category, 'BOOM_ID'));
    expect(err.code).toBe(expected);
    expect(err.details).toMatchObject({ runId: 'r1', mastraId: 'BOOM_ID' });
  });

  it('maps a plain (non-Mastra-shaped) error to AGENT_RUN_FAILED with no mastraId in details', () => {
    const err = mapMastraError(new Error('plain'));
    expect(err.code).toBe(ErrorCode.AGENT_RUN_FAILED);
    expect(
      (err.details as Record<string, unknown> | undefined)?.mastraId,
    ).toBeUndefined();
  });
});
