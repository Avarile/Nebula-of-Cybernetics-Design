import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { RELEASE } from './version';

/**
 * Sentry initialization.
 *
 * MUST be imported before anything else (it is the first import in `main.ts`)
 * so the SDK can patch libraries before NestJS loads them. This file runs
 * before `ConfigModule` loads `.env`, so it reads real environment variables
 * directly and no-ops when no DSN is present (e.g. local development).
 *
 * `./version` is safe to import this early: it is a JSON read with no side
 * effects and no Nest dependencies, so it cannot pull anything in ahead of the
 * SDK's instrumentation.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Without a release, every stack trace is attributed to "the app" and
    // regressions cannot be pinned to a deploy — and uploaded source maps have
    // nothing to bind to. Carries the git sha when the build stamped one, so
    // two builds of the same version stay distinguishable.
    release: RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: Number(
      process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1',
    ),
    integrations: [nodeProfilingIntegration()],
  });
}
