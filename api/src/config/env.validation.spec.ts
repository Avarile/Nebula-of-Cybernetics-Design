import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('applies defaults for a minimal environment', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_PORT).toBe(5432);
    expect(env.REDIS_HOST).toBe('localhost');
  });

  it('coerces numeric strings', () => {
    const env = validateEnv({ PORT: '8080', REDIS_PORT: '6380' });
    expect(env.PORT).toBe(8080);
    expect(env.REDIS_PORT).toBe(6380);
  });

  it('parses boolean-like strings without the Boolean("false") footgun', () => {
    expect(validateEnv({ DATABASE_SSL: 'false' }).DATABASE_SSL).toBe(false);
    expect(validateEnv({ DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
    expect(validateEnv({ DATABASE_SSL: '1' }).DATABASE_SSL).toBe(true);
  });

  it('throws with a readable message on invalid values', () => {
    expect(() => validateEnv({ PORT: 'not-a-number' })).toThrow(
      /Invalid environment variables/,
    );
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(
      /Invalid environment variables/,
    );
  });

  it('applies MeiliSearch defaults', () => {
    const env = validateEnv({});
    expect(env.MEILISEARCH_HOST).toBe('localhost');
    expect(env.MEILISEARCH_PORT).toBe(7700);
    expect(env.SEARCH_MAX_PAGE_SIZE).toBe(100);
  });

  it('requires a master key in production', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', MEILISEARCH_MASTER_KEY: '' }),
    ).toThrow(/MEILISEARCH_MASTER_KEY/);
  });
});

describe('auth env', () => {
  it('applies auth/security defaults', () => {
    const env = validateEnv({});
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(604800);
    expect(env.JWT_ISSUER).toBe('cybernetics');
    expect(env.THROTTLE_LIMIT).toBe(100);
  });

  it('rejects the placeholder JWT secret in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-insecure-secret-change-me-please',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('requires a seed admin password in production', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: '' }),
    ).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  it('rejects the placeholder password reset pepper in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        PASSWORD_RESET_PEPPER: 'dev-insecure-reset-pepper-change-me',
      }),
    ).toThrow(/PASSWORD_RESET_PEPPER/);
  });

  it('rejects a too-short password reset pepper in production', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', PASSWORD_RESET_PEPPER: 'short' }),
    ).toThrow(/PASSWORD_RESET_PEPPER/);
  });
});

describe('system encryption key', () => {
  const otherProdVars = {
    MEILISEARCH_MASTER_KEY: 'a-real-master-key',
    JWT_ACCESS_SECRET: 'a-real-jwt-secret-that-is-long-enough-32',
    SEED_ADMIN_PASSWORD: 'a-real-admin-password',
    MINIO_ROOT_USER: 'not-minioadmin',
    MINIO_ROOT_PASSWORD: 'not-minioadmin',
    AI_GATEWAY_API_KEY: 'a-real-gateway-api-key',
    PASSWORD_RESET_PEPPER: 'a-real-reset-pepper-value',
    CORS_ORIGINS: 'https://app.example.com',
    FILE_ALLOWED_MIME: 'application/pdf,text/plain',
  };

  it('rejects the all-zero dev default key in production', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', ...otherProdVars }),
    ).toThrow(/SYSTEM_ENCRYPTION_KEY/);
  });

  it('rejects an explicit all-zero key in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        ...otherProdVars,
        SYSTEM_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    ).toThrow(/SYSTEM_ENCRYPTION_KEY/);
  });

  it('accepts a real non-zero 32-byte key in production', () => {
    const realKey = Buffer.from('a'.repeat(32)).toString('base64');
    const env = validateEnv({
      NODE_ENV: 'production',
      ...otherProdVars,
      SYSTEM_ENCRYPTION_KEY: realKey,
    });
    expect(env.SYSTEM_ENCRYPTION_KEY).toBe(realKey);
  });
});

describe('production CORS guard', () => {
  const prod = {
    NODE_ENV: 'production',
    MEILISEARCH_MASTER_KEY: 'a-real-master-key',
    JWT_ACCESS_SECRET: 'a-real-jwt-secret-that-is-long-enough-32',
    SEED_ADMIN_PASSWORD: 'a-real-admin-password',
    MINIO_ROOT_USER: 'not-minioadmin',
    MINIO_ROOT_PASSWORD: 'not-minioadmin',
    AI_GATEWAY_API_KEY: 'a-real-gateway-api-key',
    PASSWORD_RESET_PEPPER: 'a-real-reset-pepper-value',
    SYSTEM_ENCRYPTION_KEY: Buffer.from('a'.repeat(32)).toString('base64'),
    CORS_ORIGINS: 'https://app.example.com',
    FILE_ALLOWED_MIME: 'application/pdf',
  };

  // An empty allowlist makes main.ts reflect whatever Origin arrives. Fine for
  // local development; in production it should be a stated list.
  it('rejects an empty CORS_ORIGINS in production', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('rejects a whitespace-only CORS_ORIGINS in production', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: '   ' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('accepts an explicit origin list', () => {
    expect(() =>
      validateEnv({ ...prod, CORS_ORIGINS: 'https://app.example.com' }),
    ).not.toThrow();
  });

  it('leaves development alone', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).not.toThrow();
  });
});
