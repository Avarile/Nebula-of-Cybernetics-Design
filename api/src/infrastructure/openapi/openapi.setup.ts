import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { NextFunction, Request, Response } from 'express';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { OpenApiConfig } from '../../config/configurations/openapi.config';
import { buildDocumentConfig } from './openapi.document';
import {
  OPENAPI_JSON_PATH,
  OPENAPI_REFERENCE_PATH,
  SCALAR_CSP,
} from './openapi.constants';
import {
  applyGlobalSecurity,
  attachStandardErrors,
  collectPublicOperationIds,
  operationId,
  registerErrorComponents,
  stripSecurityForPublic,
} from './openapi.postprocess';

/**
 * Mounts the OpenAPI JSON document and the Scalar reference UI.
 *
 * Both endpoints are served as raw HTTP-adapter routes / middleware, i.e.
 * OUTSIDE the Nest guard pipeline, so the global `JwtAuthGuard` does not block
 * them — the docs are intentionally public (gated only by `OPENAPI_ENABLED`).
 *
 * Pipeline:
 *  1. `createDocument` — discover routes + zod DTO schemas (deterministic
 *     operationId so `@Public()` overrides can be matched back to operations).
 *  2. `cleanupOpenApiDoc` — finalize the createZodDto-derived schemas.
 *  3. global bearer security + `@Public()` → `security: []` overrides.
 *  4. register the `ErrorEnvelope` component + attach standard error responses.
 *
 * Call this once during bootstrap, before `app.listen()`.
 */
export function setupOpenApi(app: INestApplication): void {
  const cfg = app.get(ConfigService).getOrThrow<OpenApiConfig>('openapi');
  if (!cfg.enabled) {
    return;
  }

  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, buildDocumentConfig(cfg), {
      operationIdFactory: (controllerKey, methodKey) =>
        operationId(controllerKey, methodKey),
    }),
  );

  const publicIds = collectPublicOperationIds(app);
  applyGlobalSecurity(document);
  stripSecurityForPublic(document, publicIds);
  registerErrorComponents(document);
  attachStandardErrors(document, publicIds);

  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(OPENAPI_JSON_PATH, (_req: Request, res: Response) => {
    res.json(document);
  });

  // The Scalar UI loads its bundle from a CDN + runs an inline bootstrap, both
  // blocked by helmet's global `script-src 'self'`. Override the CSP for this
  // route only (helmet ran earlier in the chain; setHeader replaces its value).
  app.use(
    OPENAPI_REFERENCE_PATH,
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Content-Security-Policy', SCALAR_CSP);
      next();
    },
    apiReference({ content: document }),
  );
}
