import { HttpException, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import { AppException, AppExceptionOptions } from './app-exception';
import { ErrorCode } from './error-codes';
import { STATUS_TO_CODE } from './error-registry';
import { isMastraError, mapMastraError } from './mappers/mastra-error.mapper';
import { mapInfraError } from './mappers/infra-error.mapper';

export interface ValidationIssue {
  path: string;
  message: string;
}

@Injectable()
export class ExceptionService {
  /** Build an AppException from any registered code. Caller writes `throw`. */
  create(code: ErrorCode, opts?: AppExceptionOptions): AppException {
    return new AppException(code, opts);
  }

  /** Build a VALIDATION_FAILED error with the standard `{ issues }` details shape. */
  validation(
    issues: ValidationIssue[],
    opts?: { message?: string },
  ): AppException {
    return new AppException(ErrorCode.VALIDATION_FAILED, {
      message: opts?.message,
      details: { issues },
    });
  }

  /** Normalize ANY thrown value into an AppException. The filter's mapping brain. */
  from(err: unknown): AppException {
    if (err instanceof AppException) return err;
    if (err instanceof HttpException) return this.fromHttpException(err);
    if (err instanceof ZodError) {
      return this.validation(
        err.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }
    if (isMastraError(err)) return mapMastraError(err);
    const infra = mapInfraError(err);
    if (infra) return infra;
    return new AppException(ErrorCode.INTERNAL_ERROR, { cause: err });
  }

  private fromHttpException(err: HttpException): AppException {
    const status = err.getStatus();
    const res = err.getResponse();
    const body: Record<string, unknown> =
      typeof res === 'object' && res !== null
        ? (res as Record<string, unknown>)
        : { message: res };

    // The Zod validation pipe throws BadRequest with an `issues` array.
    if (status === 400 && Array.isArray(body.issues)) {
      return new AppException(ErrorCode.VALIDATION_FAILED, {
        details: { issues: body.issues },
        cause: err,
      });
    }

    const message = typeof body.message === 'string' ? body.message : undefined;

    const mapped = STATUS_TO_CODE[status];
    if (mapped) return new AppException(mapped, { message, cause: err });

    // No dedicated code for this status. Preserve genuine client (4xx) errors
    // as-is — masking them as 500s changes the response contract and hides an
    // actionable message. Everything else is treated as INTERNAL.
    if (status >= 400 && status < 500) {
      return new AppException(ErrorCode.CLIENT_ERROR, {
        status,
        message,
        cause: err,
      });
    }
    return new AppException(ErrorCode.INTERNAL_ERROR, { cause: err });
  }
}
