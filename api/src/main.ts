import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { Pool } from 'pg';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configurations/app.config';
import type { AuthConfig } from './config/configurations/auth.config';
import { assertEveryRouteDeclaresPolicy } from './common/route-policy.audit';
import { assertPermissionCatalogIsComplete } from './features/authorization/permission-catalog.assertion';
import { PG_POOL } from './infrastructure/database/drizzle.constants';
import {
  assertSchemaIsCurrent,
  migrationsDir,
} from './infrastructure/database/schema-version.guard';
import { setupOpenApi } from './infrastructure/openapi/openapi.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route Nest's framework + HTTP logs through Pino.
  app.useLogger(app.get(Logger));

  // Enable OnApplicationShutdown / OnModuleDestroy hooks (Redis, DB, queues).
  app.enableShutdownHooks();

  // Refuse to start if any route declares neither @Public() nor @Roles(...).
  // An undeclared route is reachable by every authenticated principal, which is
  // how the search endpoints became world-readable — make that a crash, not a
  // default. Runs before listen() so a misconfigured build never serves traffic.
  assertEveryRouteDeclaresPolicy(app);

  // A `@RequirePermission` naming a key nobody seeded denies every caller
  // silently, and surfaces as an unexplained 403 in production rather than here.
  await assertPermissionCatalogIsComplete(app);

  // Refuse to serve against an un-migrated database. Without this a replica on
  // an old schema booted fine and then failed at the first query, producing one
  // confusing error per endpoint instead of one clear failure here.
  await assertSchemaIsCurrent(app.get<Pool>(PG_POOL), migrationsDir());

  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');
  const auth = config.getOrThrow<AuthConfig>('auth');

  // Express defaults to a 100kb JSON body, which silently contradicted the
  // 1000-record batches `persistRecordsSchema` advertises — they were rejected
  // as 413 before validation ever ran.
  app.use(json({ limit: appCfg.bodyLimit }));
  app.use(urlencoded({ extended: true, limit: appCfg.bodyLimit }));

  app.use(helmet());

  // An empty allowlist reflects any origin. Harmless for a Bearer-only API in
  // development, and rejected outright in production by the env schema.
  app.enableCors({
    origin: auth.corsOrigins.length > 0 ? auth.corsOrigins : true,
    credentials: false, // Bearer transport — no cookies, no CSRF surface
  });

  // Mount OpenAPI JSON + Scalar reference UI. Must run before listen(): the
  // docs routes are registered ahead of Nest's router so they stay reachable
  // and bypass the global JwtAuthGuard (docs are public, gated by OPENAPI_ENABLED).
  setupOpenApi(app);

  // From validated config, not raw env: `PORT=abc` is rejected at boot by the
  // schema, whereas `Number(process.env.PORT)` would have listened on NaN.
  const port = appCfg.port;
  await app.listen(port);

  app.get(Logger).debug(
    `
    Application listening on port ${port}
    OPENAPI(Scalar) is live at /reference
    OPENAPI JSON is live at /openapi.json
    `,
    'Bootstrap',
  );
}

void bootstrap();
