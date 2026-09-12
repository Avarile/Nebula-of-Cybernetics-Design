import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';
import { SearchEngineError } from '../../search-engine/search-engine.interface';
import { NoActiveEmailConfigError } from '../../email/email.types';

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
]);
const REDIS_ERROR_NAMES = new Set([
  'MaxRetriesPerRequestError',
  'ClusterAllFailedError',
]);

/**
 * Normalizes raw driver/SDK errors at the boundary. Returns null when the error
 * is not a recognized infrastructure failure (the caller then falls back to
 * INTERNAL_ERROR). Detection is deliberately conservative and heuristic; precise
 * per-dependency attribution is a v2 concern.
 */
export function mapInfraError(err: unknown): AppException | null {
  if (err instanceof SearchEngineError) {
    return new AppException(ErrorCode.SEARCH_UNAVAILABLE, { cause: err });
  }
  if (err instanceof NoActiveEmailConfigError) {
    return new AppException(ErrorCode.MAIL_CONFIG_MISSING, { cause: err });
  }
  const gateway = mapAiGatewayError(err);
  if (gateway) return gateway;

  const code = findInCauseChain(err, 'code');
  const name = findInCauseChain(err, 'name');

  // Postgres (pg driver SQLSTATE codes)
  //
  // Integrity violations describe the REQUEST, not a fault in the server: the
  // caller named a row that is not there, or sent a value the schema refuses.
  // Letting them fall through to INTERNAL_ERROR turned "you referenced a
  // company that does not exist" into a 500 and hid it from the client.
  //
  // This is a net, not a licence to skip validating references in the service:
  // it can only say "conflict", whereas an explicit check can name the field.
  // `cause` is preserved either way, so a violation that really is our bug
  // still reaches the logs intact.
  if (code === '23505' || code === '23503') {
    return new AppException(ErrorCode.CONFLICT, { cause: err });
  }
  // not_null_violation / check_violation — a payload the DTO admitted and the
  // schema then rejected. That is a validation failure by any other name.
  if (code === '23502' || code === '23514') {
    return new AppException(ErrorCode.VALIDATION_FAILED, { cause: err });
  }
  // invalid_text_representation — e.g. a string that is not a member of an
  // enum column. Reached when a raw path or query parameter goes to the
  // database unvalidated.
  if (code === '22P02') {
    return new AppException(ErrorCode.VALIDATION_FAILED, { cause: err });
  }
  if (
    code &&
    (code.startsWith('08') || code.startsWith('53') || code.startsWith('57'))
  ) {
    return new AppException(ErrorCode.DB_UNAVAILABLE, { cause: err });
  }

  // Object storage (MinIO / S3)
  if (code === 'NoSuchKey' || code === 'NotFound') {
    return new AppException(ErrorCode.STORAGE_OBJECT_NOT_FOUND, { cause: err });
  }

  // Redis / ioredis
  if (name && REDIS_ERROR_NAMES.has(name)) {
    return new AppException(ErrorCode.CACHE_UNAVAILABLE, { cause: err });
  }

  // Crypto (AES-GCM)
  if (
    err instanceof Error &&
    (/Malformed encryption envelope/i.test(err.message) ||
      /unable to authenticate data/i.test(err.message))
  ) {
    return new AppException(ErrorCode.CRYPTO_DECRYPT_FAILED, { cause: err });
  }

  // Generic network failure to a backing service
  if (code && NETWORK_CODES.has(code)) {
    return new AppException(ErrorCode.DEPENDENCY_UNAVAILABLE, { cause: err });
  }

  return null;
}

/**
 * Errors raised by the AI SDK model gateway (`@ai-sdk/gateway`).
 *
 * Recognised structurally rather than with `instanceof`: the SDK is ESM-only,
 * and importing it here would drag the model stack into every module that can
 * throw — the same transitive-dependency trap that split SharedModule.
 *
 * The shape is the package's own public contract: `GatewayError` subclasses
 * carry a `Gateway*` name, a snake_case `type` discriminator
 * (`authentication_error`, `rate_limit_exceeded`, …) and a numeric
 * `statusCode`.
 *
 * Without this, a chat request against an unset `AI_GATEWAY_API_KEY` answered
 * `500 INTERNAL_ERROR` — indistinguishable from a genuine fault in our own
 * code, and so the sort of thing that pages an on-call engineer to go and read
 * a config file. Everything here resolves to a status that names the upstream
 * instead; `cause` is preserved, so the specific gateway message still reaches
 * the logs.
 */
function mapAiGatewayError(err: unknown): AppException | null {
  if (!(err instanceof Error)) return null;
  const candidate = err as Error & { type?: unknown; statusCode?: unknown };
  if (
    !err.name.startsWith('Gateway') ||
    typeof candidate.type !== 'string' ||
    typeof candidate.statusCode !== 'number'
  ) {
    return null;
  }

  const status = candidate.statusCode;
  if (status === 429) {
    return new AppException(ErrorCode.LLM_RATE_LIMITED, { cause: err });
  }
  if (status === 408 || status === 504) {
    return new AppException(ErrorCode.LLM_TIMEOUT, { cause: err });
  }
  // 401/403 mean OUR credential is missing or rejected — a deployment problem,
  // not the caller's. It still resolves to "the provider refused us" rather
  // than "we crashed", which is the distinction that matters at 3am.
  return new AppException(ErrorCode.LLM_PROVIDER_ERROR, { cause: err });
}

/**
 * Reads a string property from an error or anything it wraps.
 *
 * Drivers rarely reach this boundary bare. Drizzle wraps every failed statement
 * in a `DrizzleQueryError` whose own `code` is undefined and whose `cause` is
 * the pg error carrying the SQLSTATE — so matching on the outer error alone
 * silently skipped the entire Postgres branch below. A unique violation
 * answered 500 exactly like a foreign-key one; the `23505` rule had been
 * unreachable in production for as long as it had existed, and only looked
 * correct because its unit test handed it a bare error.
 *
 * Depth is bounded, and visited nodes are tracked, because `cause` chains are
 * attacker-adjacent data in the general case and a cycle here would hang the
 * exception filter — the one place that must never throw.
 */
function findInCauseChain(
  err: unknown,
  property: 'code' | 'name',
): string | undefined {
  const seen = new Set<unknown>();
  let current = err;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    const value = (current as Record<string, unknown>)[property];
    // A wrapper's own `name` ("DrizzleQueryError") is truthy but tells us
    // nothing, so keep walking when nothing below matched a known rule. For
    // `code` the first defined value wins: only the driver sets one.
    if (typeof value === 'string' && value.length > 0 && value !== 'Error') {
      if (property === 'code') return value;
      // Names are checked against a small allow-list; return the first that is
      // actually one of them rather than the outermost wrapper's class name.
      if (REDIS_ERROR_NAMES.has(value)) return value;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
