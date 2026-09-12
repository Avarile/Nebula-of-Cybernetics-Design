import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced auth/security config. Consumed by the auth feature (token signing,
 * strategy verification), the throttler, main.ts (CORS), and the admin seeder.
 */
export const authConfig = registerAs('auth', () => {
  const env = validateEnv(process.env);
  return {
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
    agentTokenTtl: env.AGENT_TOKEN_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    throttleTtl: env.THROTTLE_TTL,
    throttleLimit: env.THROTTLE_LIMIT,
    seedAdminEmail: env.SEED_ADMIN_EMAIL,
    seedAdminPassword: env.SEED_ADMIN_PASSWORD,
    passwordReset: {
      pepper: env.PASSWORD_RESET_PEPPER,
      codeTtlSeconds: env.PASSWORD_RESET_CODE_TTL,
      maxAttempts: env.PASSWORD_RESET_MAX_ATTEMPTS,
      codeLength: 6,
    },
  };
});

export type AuthConfig = ReturnType<typeof authConfig>;
