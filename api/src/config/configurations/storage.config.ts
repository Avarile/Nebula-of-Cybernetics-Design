import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced object-storage config (MinIO connection + file policy). Consumed by
 * the file-manage infrastructure module, the MinIO health indicator, and the
 * file-processor feature's policy checks.
 */
export const storageConfig = registerAs('storage', () => {
  const env = validateEnv(process.env);
  const allowedMimeTypes = env.FILE_ALLOWED_MIME.split(',')
    .map((mime) => mime.trim())
    .filter((mime) => mime.length > 0);

  return {
    // MinIO connection
    endpoint: env.MINIO_HOST,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
    region: env.MINIO_REGION,
    bucket: env.MINIO_BUCKET,
    presignExpirySeconds: env.MINIO_PRESIGN_EXPIRY,

    // File policy
    maxFileSize: env.FILE_MAX_SIZE,
    allowedMimeTypes, // empty array = allow any MIME type
    pendingTtlSeconds: env.FILE_PENDING_TTL,
    /** Retention for soft-deleted files before the bytes are purged. */
    purgeAfterDays: env.FILE_PURGE_AFTER_DAYS,
  };
});

export type StorageConfig = ReturnType<typeof storageConfig>;
