import type { Params } from 'nestjs-pino';

export interface LoggerOptions {
  level: string;
  /** Enable human-readable `pino-pretty` output (development only). */
  pretty: boolean;
}

/**
 * Builds the `nestjs-pino` configuration. Redacts common secret-bearing fields
 * and enables `pino-pretty` transport outside production.
 */
export function buildLoggerParams({ level, pretty }: LoggerOptions): Params {
  return {
    pinoHttp: {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      autoLogging: true,
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, colorize: true },
          }
        : undefined,
    },
  };
}
