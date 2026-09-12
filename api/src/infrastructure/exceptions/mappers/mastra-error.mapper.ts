import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';

interface MastraLikeError extends Error {
  id: string;
  domain: string;
  category: string;
  details?: Record<string, unknown>;
}

export function isMastraError(err: unknown): err is MastraLikeError {
  return (
    err instanceof Error &&
    typeof (err as Partial<MastraLikeError>).id === 'string' &&
    typeof (err as Partial<MastraLikeError>).domain === 'string' &&
    typeof (err as Partial<MastraLikeError>).category === 'string'
  );
}

const STORAGE_DOMAINS = new Set(['STORAGE', 'MASTRA_MEMORY', 'MASTRA_VECTOR']);
const TOOL_DOMAINS = new Set(['TOOL', 'MCP']);

export function mapMastraError(err: unknown): AppException {
  if (!isMastraError(err)) {
    return new AppException(ErrorCode.AGENT_RUN_FAILED, { cause: err });
  }
  const { category, domain, id, details } = err;
  let code: ErrorCode;
  if (category === 'USER') {
    code = ErrorCode.AGENT_REQUEST_INVALID;
  } else if (category === 'THIRD_PARTY') {
    code = STORAGE_DOMAINS.has(domain)
      ? ErrorCode.DEPENDENCY_UNAVAILABLE
      : ErrorCode.LLM_PROVIDER_ERROR;
  } else {
    code = TOOL_DOMAINS.has(domain)
      ? ErrorCode.TOOL_EXECUTION_FAILED
      : ErrorCode.AGENT_RUN_FAILED;
  }
  return new AppException(code, {
    details: { ...(details ?? {}), mastraId: id },
    cause: err,
  });
}
