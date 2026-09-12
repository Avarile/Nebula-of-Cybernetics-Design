import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

export const sentryConfig = registerAs('sentry', () => {
  const env = validateEnv(process.env);
  return {
    dsn: env.SENTRY_DSN || undefined,
    enabled: env.SENTRY_DSN.length > 0,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE,
    environment: env.NODE_ENV,
  };
});

export type SentryConfig = ReturnType<typeof sentryConfig>;
