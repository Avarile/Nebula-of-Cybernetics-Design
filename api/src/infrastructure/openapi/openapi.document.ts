import { DocumentBuilder } from '@nestjs/swagger';
import type { OpenApiConfig } from '../../config/configurations/openapi.config';
import {
  API_DESCRIPTION,
  API_TITLE,
  API_VERSION,
  BEARER_SCHEME_NAME,
  OPENAPI_TAGS,
} from './openapi.constants';

/**
 * Builds the base OpenAPI document config (info, servers, tags, security
 * schemes). Route/schema discovery is layered on by `SwaggerModule.createDocument`;
 * global security + `@Public()` overrides + error components are applied by the
 * post-processors in `openapi.postprocess.ts`.
 */
export function buildDocumentConfig(cfg: OpenApiConfig) {
  const builder = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(API_DESCRIPTION)
    .setVersion(API_VERSION)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
        description: 'JWT access token issued by `POST /auth/login`.',
      },
      BEARER_SCHEME_NAME,
    );

  if (cfg.serverUrl) {
    builder.addServer(cfg.serverUrl);
  }

  for (const tag of OPENAPI_TAGS) {
    builder.addTag(tag.name, tag.description);
  }

  return builder.build();
}
