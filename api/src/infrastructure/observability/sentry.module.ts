import { Module } from '@nestjs/common';
import { SentryModule as SentryCoreModule } from '@sentry/nestjs/setup';

/**
 * Wires Sentry into the Nest request lifecycle.
 *
 * `SentryModule.forRoot()` is imported from `@sentry/nestjs/setup` (NOT the
 * package root) so `@nestjs/common` is loaded after OpenTelemetry patches it.
 * The actual `Sentry.init()` lives in `src/instrument.ts`.
 *
 * Error reporting to Sentry is owned by `GlobalExceptionFilter`
 * (`infrastructure/exceptions`), which captures DEPENDENCY/INTERNAL errors with
 * `code` + `correlationId` tags — so no `SentryGlobalFilter` is registered here.
 */
@Module({
  imports: [SentryCoreModule.forRoot()],
})
export class ObservabilityModule {}
