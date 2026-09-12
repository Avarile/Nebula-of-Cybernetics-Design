import { GUEST_PRINCIPAL } from '../../../common/principal';
import { REQUEST_CTX } from '../mastra.constants';
import type { ToolRuntime } from '../mastra.types';

/**
 * Reads our per-call values out of Mastra's tool execution context.
 * `context.requestContext` is Mastra's `RequestContext` class (Map-like: `.get(key)`,
 * confirmed against `node_modules/@mastra/core/dist/tools/types.d.ts` — the tool
 * `execute`'s second arg types `requestContext?: RequestContext<...>`, and
 * `RequestContext` exposes `get<K>(key: K)`). If that shape ever changes, adjust the
 * three `.get(...)` calls here only.
 */
export function readRuntime(context: unknown): ToolRuntime {
  const rc = (context as { requestContext?: { get(k: string): unknown } })
    ?.requestContext;
  // Fail closed: a tool invoked without a request context gets the anonymous
  // principal, not a privileged one.
  const principal =
    (rc?.get(REQUEST_CTX.principal) as ToolRuntime['principal']) ??
    GUEST_PRINCIPAL;
  return {
    principal,
    runId: (rc?.get(REQUEST_CTX.runId) as string) ?? null,
    conversationId: (rc?.get(REQUEST_CTX.conversationId) as string) ?? null,
  };
}
