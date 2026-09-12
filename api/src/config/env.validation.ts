import { z } from 'zod';

/**
 * Coerces common truthy string representations into booleans.
 * `z.coerce.boolean()` is unsafe for env vars because `Boolean('false') === true`.
 */
const booleanFromEnv = z.preprocess(
  (value) => value === true || value === 'true' || value === '1',
  z.boolean(),
);

export const envSchema = z
  .object({
    // Application
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_NAME: z.string().min(1).default('cybernetics'),

    // PostgreSQL
    DATABASE_HOST: z.string().min(1).default('localhost'),
    DATABASE_PORT: z.coerce.number().int().positive().default(5432),
    DATABASE_USER: z.string().min(1).default('postgres'),
    DATABASE_PASSWORD: z.string().default('postgres'),
    DATABASE_NAME: z.string().min(1).default('cybernetics'),
    DATABASE_SSL: booleanFromEnv.default(false),
    /** Verify the DB server's TLS certificate. Disable only for self-signed dev servers. */
    DATABASE_SSL_REJECT_UNAUTHORIZED: booleanFromEnv.default(true),
    /** pg pool size for the WHOLE process: HTTP handlers + queue workers + Mastra's store. */
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
    DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30_000),
    /** Fail rather than wait forever when the pool is saturated. */
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    DATABASE_LOGGING: booleanFromEnv.default(false),

    // Redis (shared by cache, session cache, and BullMQ)
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().default(''),
    REDIS_DB: z.coerce.number().int().min(0).default(0),

    // Observability (Sentry)
    SENTRY_DSN: z.string().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    /**
     * Heap ceiling past which the admin health report calls the process
     * degraded. Reported only — it does not fail the liveness or readiness
     * probes, so crossing it cannot get a pod restarted or pulled from the load
     * balancer. Container memory limits are the right tool for that.
     */
    HEALTH_HEAP_THRESHOLD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1_073_741_824),

    // Logging
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // MinIO / object storage
    MINIO_HOST: z.string().min(1).default('localhost'),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: booleanFromEnv.default(false),
    MINIO_ROOT_USER: z.string().min(1).default('minioadmin'),
    MINIO_ROOT_PASSWORD: z.string().min(1).default('minioadmin'),
    MINIO_REGION: z.string().min(1).default('us-east-1'),
    MINIO_BUCKET: z.string().min(1).default('cybernetics'),
    MINIO_PRESIGN_EXPIRY: z.coerce.number().int().positive().default(300),

    // File policy
    FILE_MAX_SIZE: z.coerce.number().int().positive().default(52_428_800),
    /**
     * Comma-separated upload allowlist. Empty means ALLOW ANY, which is fine
     * for development but is rejected in production below — an unrestricted
     * upload surface feeds bytes straight to the document parsers.
     */
    FILE_ALLOWED_MIME: z.string().default(''),
    FILE_PENDING_TTL: z.coerce.number().int().positive().default(3600),
    /**
     * Retention for soft-deleted files. Mirrors SEARCH_PURGE_AFTER_DAYS — before
     * this existed the hourly sweep hard-deleted soft-deleted rows and their
     * objects on its next pass, so a delete was irrecoverable within the hour.
     */
    FILE_PURGE_AFTER_DAYS: z.coerce.number().int().positive().default(30),

    // MeiliSearch / search engine
    MEILISEARCH_HOST: z.string().min(1).default('localhost'),
    MEILISEARCH_PORT: z.coerce.number().int().positive().default(7700),
    MEILISEARCH_USE_SSL: booleanFromEnv.default(false),
    MEILISEARCH_MASTER_KEY: z.string().default(''),
    MEILISEARCH_INDEX_PREFIX: z.string().default(''),
    MEILISEARCH_TASK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    MEILISEARCH_SEARCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    SEARCH_DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(20),
    SEARCH_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
    /** Meili `pagination.maxTotalHits` — the deep-pagination ceiling per index. */
    SEARCH_MAX_TOTAL_HITS: z.coerce.number().int().positive().default(10_000),

    // Search indexing pipeline (Postgres → async → Meili)
    /** How often the reconciliation sweep repairs unconverged records. */
    SEARCH_RECONCILE_EVERY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60_000),
    /** A record must be unconverged for this long before the sweep retries it. */
    SEARCH_RECONCILE_STALE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300_000),
    /**
     * Ceiling on the sweep's per-record backoff. The wait before a retry doubles
     * with each failed attempt, so a permanently broken record settles at this
     * interval instead of retrying every few minutes forever.
     */
    SEARCH_RECONCILE_MAX_BACKOFF_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3_600_000),
    /** Max records re-enqueued per sweep. */
    SEARCH_RECONCILE_BATCH: z.coerce.number().int().positive().default(500),
    /** BullMQ worker concurrency for the search-indexing queue. */
    SEARCH_INDEX_CONCURRENCY: z.coerce.number().int().positive().default(4),
    /** Max record ids carried in one batched index job. */
    SEARCH_INDEX_BATCH_SIZE: z.coerce.number().int().positive().default(500),
    /** Attempt count past which a record is reported as stuck (observability only). */
    SEARCH_MAX_INDEX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    /** Retention for soft-deleted records whose removal Meili has confirmed. */
    SEARCH_PURGE_AFTER_DAYS: z.coerce.number().int().positive().default(30),
    /** How often the purge sweep runs. */
    SEARCH_PURGE_EVERY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400_000),
    /** Max rows hard-deleted per purge sweep. */
    SEARCH_PURGE_BATCH: z.coerce.number().int().positive().default(1_000),
    /** Ceiling for the optional `?wait=true` convergence poll on persist. */
    SEARCH_WAIT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    /** Index lag past which the health check reports search as degraded. */
    SEARCH_LAG_ALERT_SECONDS: z.coerce.number().int().positive().default(300),
    /** TTL on compiled-collection cache entries (backstop for lost invalidations). */
    SEARCH_REGISTRY_TTL_MS: z.coerce.number().int().positive().default(60_000),

    // Mastra AI agent
    AI_GATEWAY_API_KEY: z.string().default(''),
    MASTRA_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.6'),
    MASTRA_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    MASTRA_MEMORY_LAST_MESSAGES: z.coerce.number().int().positive().default(20),
    MASTRA_APPROVAL_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400_000),
    MASTRA_SCHEDULES_ENABLED: booleanFromEnv.default(false),
    /** Ceiling on one agent turn. Without it a hung model call holds a request open. */
    MASTRA_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

    // Auth / JWT
    JWT_ACCESS_SECRET: z
      .string()
      .min(1)
      .default('dev-insecure-secret-change-me-please'),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604_800),
    AGENT_TOKEN_TTL: z.coerce.number().int().positive().default(900),
    JWT_ISSUER: z.string().min(1).default('cybernetics'),
    /** Verified on every token, so a token minted for another service is refused. */
    JWT_AUDIENCE: z.string().min(1).default('cybernetics-api'),

    /**
     * Max JSON request body. Express defaults to 100kb, which silently
     * contradicted `persistRecordsSchema`'s 1000-record batches — any realistic
     * batch was rejected before validation ever ran.
     */
    REQUEST_BODY_LIMIT: z.string().min(1).default('2mb'),

    // Security
    THROTTLE_TTL: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    CORS_ORIGINS: z.string().default(''),

    // Auth seeding
    SEED_ADMIN_EMAIL: z.string().email().default('admin@cybernetics.local'),
    SEED_ADMIN_PASSWORD: z.string().default(''),

    // Password reset (forgot-password OTP)
    PASSWORD_RESET_PEPPER: z
      .string()
      .min(1)
      .default('dev-insecure-reset-pepper-change-me'),
    PASSWORD_RESET_CODE_TTL: z.coerce.number().int().positive().default(900),
    PASSWORD_RESET_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

    // System module (secret encryption at rest)
    SYSTEM_ENCRYPTION_KEY: z
      .string()
      .default('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), // 32 zero-bytes (dev/test only)
    SYSTEM_ENCRYPTION_KEY_VERSION: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
    /** How long a system setting stays cached. Invalidated on write regardless. */
    SYSTEM_SETTINGS_CACHE_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300_000),
    /**
     * Retired encryption keys, `{"1":"<base64>"}`. Lets a rotation decrypt what
     * the previous key wrote — without it, rotating SYSTEM_ENCRYPTION_KEY makes
     * every stored secret permanently unreadable.
     */
    SYSTEM_ENCRYPTION_KEYS_PREVIOUS: z.string().default(''),

    // OpenAPI / API reference docs (Scalar)
    OPENAPI_ENABLED: booleanFromEnv.default(true),
    OPENAPI_SERVER_URL: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    // Refuse the well-known default MinIO credentials in production.
    if (
      env.NODE_ENV === 'production' &&
      env.MINIO_ROOT_USER === 'minioadmin' &&
      env.MINIO_ROOT_PASSWORD === 'minioadmin'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MINIO_ROOT_PASSWORD'],
        message:
          'Default MinIO credentials (minioadmin) are not allowed when NODE_ENV=production; set MINIO_ROOT_USER and MINIO_ROOT_PASSWORD.',
      });
    }

    if (
      env.NODE_ENV === 'production' &&
      env.FILE_ALLOWED_MIME.trim().length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FILE_ALLOWED_MIME'],
        message:
          'FILE_ALLOWED_MIME must list the accepted upload types when NODE_ENV=production (empty allows any type).',
      });
    }

    // Require a master key in production.
    if (
      env.NODE_ENV === 'production' &&
      env.MEILISEARCH_MASTER_KEY.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEILISEARCH_MASTER_KEY'],
        message: 'MEILISEARCH_MASTER_KEY is required when NODE_ENV=production.',
      });
    }

    // A page larger than the index's total-hits ceiling can never be filled, so
    // the two limits would silently contradict each other.
    if (env.SEARCH_MAX_TOTAL_HITS < env.SEARCH_MAX_PAGE_SIZE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEARCH_MAX_TOTAL_HITS'],
        message:
          'SEARCH_MAX_TOTAL_HITS must be >= SEARCH_MAX_PAGE_SIZE (a page cannot exceed the index hit ceiling).',
      });
    }

    if (
      env.NODE_ENV === 'production' &&
      (env.JWT_ACCESS_SECRET === 'dev-insecure-secret-change-me-please' ||
        env.JWT_ACCESS_SECRET.length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message:
          'JWT_ACCESS_SECRET must be a strong non-default value (>= 32 chars) when NODE_ENV=production.',
      });
    }

    if (
      env.NODE_ENV === 'production' &&
      (env.PASSWORD_RESET_PEPPER === 'dev-insecure-reset-pepper-change-me' ||
        env.PASSWORD_RESET_PEPPER.length < 16)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PASSWORD_RESET_PEPPER'],
        message:
          'PASSWORD_RESET_PEPPER must be a strong non-default value (>= 16 chars) when NODE_ENV=production.',
      });
    }

    // `CORS_ORIGINS` empty means "reflect any origin" in main.ts. Tolerable in
    // development; in production it should be a deliberate list.
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message:
          'CORS_ORIGINS must list the allowed origins when NODE_ENV=production (empty reflects any origin).',
      });
    }

    if (env.NODE_ENV === 'production' && env.AI_GATEWAY_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_GATEWAY_API_KEY'],
        message: 'AI_GATEWAY_API_KEY is required when NODE_ENV=production.',
      });
    }

    if (env.NODE_ENV === 'production' && env.SEED_ADMIN_PASSWORD.length < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEED_ADMIN_PASSWORD'],
        message:
          'SEED_ADMIN_PASSWORD must be set (>= 12 chars) when NODE_ENV=production.',
      });
    }

    // Require a real, non-zero 32-byte encryption key in production. The dev
    // default is 32 ZERO bytes, which passes a length-only check — reject it
    // explicitly so a forgotten key can never silently ship to production.
    if (env.NODE_ENV === 'production') {
      let keyBuf: Buffer;
      try {
        keyBuf = Buffer.from(env.SYSTEM_ENCRYPTION_KEY, 'base64');
      } catch {
        keyBuf = Buffer.alloc(0);
      }
      const allZero = keyBuf.length > 0 && keyBuf.every((b) => b === 0);
      if (keyBuf.length !== 32 || allZero) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SYSTEM_ENCRYPTION_KEY'],
          message:
            'SYSTEM_ENCRYPTION_KEY must be a base64-encoded, non-zero 32-byte key when NODE_ENV=production.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Memoised on the exact object identity last parsed.
 *
 * Every `registerAs` factory calls `validateEnv(process.env)`, so booting ran
 * the whole schema — including `superRefine` — twelve times over the same
 * object. `process.env` is a stable reference, so keying on identity collapses
 * that to one parse while leaving explicit calls with a different object (the
 * tests, the seed runner) fully re-validated.
 */
let cache: { source: Record<string, unknown>; parsed: Env } | null = null;

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Fails fast at boot with a
 * readable list of every invalid variable. Also used by the namespaced config
 * factories and the standalone seed runner so all coercion lives here.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  if (cache && cache.source === config) return cache.parsed;
  const result = parseEnv(config);
  cache = { source: config, parsed: result };
  return result;
}

/** Test seam: drop the memo so a suite can re-parse the same object. */
export function resetEnvCache(): void {
  cache = null;
}

function parseEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
