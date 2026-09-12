import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../../config/configurations/app.config';
import { buildLoggerParams } from './logger.config';

/**
 * Application logging via Pino (`nestjs-pino`).
 *
 * `main.ts` calls `app.useLogger(app.get(Logger))` so Nest's framework logs and
 * per-request HTTP logs (with correlation ids) all flow through Pino.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const app = config.getOrThrow<AppConfig>('app');
        return buildLoggerParams({
          level: app.logLevel,
          pretty: !app.isProduction,
        });
      },
    }),
  ],
})
export class LoggerModule {}
