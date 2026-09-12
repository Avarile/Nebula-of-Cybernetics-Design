/** Public path serving the raw OpenAPI 3 JSON document. */
export const OPENAPI_JSON_PATH = '/openapi.json';

/** Public path serving the interactive Scalar reference UI. */
export const OPENAPI_REFERENCE_PATH = '/reference';

/** Security-scheme key referenced by operations requiring a JWT bearer token. */
export const BEARER_SCHEME_NAME = 'bearer';

/** CDN host the Scalar middleware loads its UI bundle + assets from by default. */
export const SCALAR_CDN_HOST = 'https://cdn.jsdelivr.net';

/**
 * Content-Security-Policy served ONLY on the Scalar reference page. The global
 * `helmet()` policy is `script-src 'self'`, which blocks Scalar's CDN bundle and
 * its inline bootstrap → a blank page. This scoped override re-allows exactly
 * what the Scalar UI needs; every other route keeps helmet's strict defaults.
 */
export const SCALAR_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${SCALAR_CDN_HOST}`,
  `style-src 'self' 'unsafe-inline' ${SCALAR_CDN_HOST} https://fonts.googleapis.com`,
  `font-src 'self' data: ${SCALAR_CDN_HOST} https://fonts.gstatic.com`,
  "img-src 'self' data: https:",
  `connect-src 'self' ${SCALAR_CDN_HOST}`,
  "worker-src 'self' blob:",
].join('; ');

export const API_TITLE = 'Cybernetics API';
export const API_VERSION = '1.0.0';
export const API_DESCRIPTION = [
  'HTTP API for the Cybernetics platform.',
  '',
  'Authenticate with a JWT bearer token (`Authorization: Bearer <token>`).',
  'Endpoints marked as public require no authentication.',
  'All errors share a single envelope shape (`ErrorEnvelope`).',
].join('\n');

/** One tag per feature module; drives Scalar's sidebar grouping. */
export const OPENAPI_TAGS: ReadonlyArray<{
  name: string;
  description: string;
}> = [
  {
    name: 'Auth',
    description: 'Login, tokens, password reset, service credentials.',
  },
  { name: 'Users', description: 'User account management.' },
  {
    name: 'Search',
    description: 'Collections and record search (search-service).',
  },
  { name: 'Files', description: 'File upload, download, and processing.' },
  { name: 'Mailbox', description: 'Inbound mail ingestion and retrieval.' },
  {
    name: 'Agent',
    description: 'Mastra AI agent: chat, schedules, approvals.',
  },
  {
    name: 'System',
    description: 'SMTP/IMAP config, settings, integration credentials, audit.',
  },
  {
    name: 'Calendar',
    description: 'Calendar events, recurrence and single-instance overrides.',
  },
  {
    name: 'Scheduler',
    description: 'Poller health, dead-letter queue and manual sweeps (admin).',
  },
];
