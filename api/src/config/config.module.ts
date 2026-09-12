import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { appConfig } from './configurations/app.config';
import { authConfig } from './configurations/auth.config';
import { databaseConfig } from './configurations/database.config';
import { mailboxConfig } from './configurations/mailbox.config';
import { mastraConfig } from './configurations/mastra.config';
import { openapiConfig } from './configurations/openapi.config';
import { redisConfig } from './configurations/redis.config';
import { searchConfig } from './configurations/search.config';
import { schedulingConfig } from './configurations/scheduling.config';
import { sentryConfig } from './configurations/sentry.config';
import { storageConfig } from './configurations/storage.config';
import { systemConfig } from './configurations/system.config';
import { validateEnv } from './env.validation';

/**
 * Global configuration module.
 *
 * - Loads `.env` and validates/coerces every variable with Zod at boot
 *   (fails fast on invalid config).
 * - Exposes namespaced, strongly-typed config objects (`app`, `database`,
 *   `redis`, `sentry`) that other modules inject instead of raw `process.env`.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      validate: validateEnv,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        redisConfig,
        sentryConfig,
        storageConfig,
        searchConfig,
        systemConfig,
        mastraConfig,
        mailboxConfig,
        openapiConfig,
        schedulingConfig,
      ],
    }),
  ],
})
export class ConfigModule {}
