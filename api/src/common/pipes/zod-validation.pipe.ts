import { createZodValidationPipe } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';

/**
 * The app's Zod validation pipe, built from nestjs-zod's factory.
 *
 * Two usage modes:
 *  - **Global** (`APP_PIPE`): auto-validates any handler param whose metatype is
 *    a `createZodDto` class, reading the schema off the DTO.
 *  - **Explicit** (`new ZodValidationPipe(schema)`): validates against a schema
 *    passed directly — kept for backward compatibility with per-route usage.
 *
 * On failure it throws the app's `AppException(VALIDATION_FAILED)` so every
 * validation error renders through the single `ErrorEnvelope` shape (same
 * `details.issues[]` mapping as the previous hand-written pipe).
 */
export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error: ZodError) =>
    new AppException(ErrorCode.VALIDATION_FAILED, {
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      },
    }),
});
