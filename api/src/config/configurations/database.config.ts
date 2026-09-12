import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

export const databaseConfig = registerAs('database', () => {
  const env = validateEnv(process.env);
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL,
    sslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    logging: env.DATABASE_LOGGING,
    poolMax: env.DATABASE_POOL_MAX,
    poolIdleTimeoutMs: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
    poolConnectionTimeoutMs: env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
  };
});

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
