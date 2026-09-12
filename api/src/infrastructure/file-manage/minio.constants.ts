import type { Client } from 'minio';

/** DI token for the raw MinIO client (internal + health check). */
export const MINIO_CLIENT = Symbol('MINIO_CLIENT');

/** DI token for the object-storage abstraction (swappable backend). */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Convenience alias for the MinIO client type. */
export type MinioClient = Client;
