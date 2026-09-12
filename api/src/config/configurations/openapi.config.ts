import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced OpenAPI/Scalar docs config. Consumed by `setupOpenApi` in the
 * bootstrap to decide whether to mount the docs endpoints and which server URL
 * to advertise in the document.
 */
export const openapiConfig = registerAs('openapi', () => {
  const env = validateEnv(process.env);
  return {
    /** Kill-switch. When false, neither `/openapi.json` nor `/reference` is mounted. */
    enabled: env.OPENAPI_ENABLED,
    /** Advertised server base URL. Empty string → omit the `servers` block. */
    serverUrl: env.OPENAPI_SERVER_URL,
  };
});

export type OpenApiConfig = ReturnType<typeof openapiConfig>;
