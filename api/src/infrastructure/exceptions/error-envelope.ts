import { AppException } from './app-exception';
import { ErrorCode, ErrorKind } from './error-codes';
import { ERROR_REGISTRY } from './error-registry';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details: unknown;
    correlationId: string;
    timestamp: string;
    path: string;
  };
}

/**
 * Renders an AppException into the single public error shape. INTERNAL errors
 * never expose their (possibly sensitive) constructed message — they fall back
 * to the curated registry message.
 */
export function buildEnvelope(
  err: AppException,
  correlationId: string,
  path: string,
): ErrorEnvelope {
  const spec = ERROR_REGISTRY[err.code];
  const message = err.kind === ErrorKind.INTERNAL ? spec.message : err.message;
  return {
    error: {
      code: err.code,
      message,
      statusCode: err.getStatus(),
      details: err.kind === ErrorKind.INTERNAL ? null : (err.details ?? null),
      correlationId,
      timestamp: new Date().toISOString(),
      path,
    },
  };
}
