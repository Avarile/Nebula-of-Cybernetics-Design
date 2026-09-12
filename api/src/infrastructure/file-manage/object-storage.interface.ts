import type { Readable } from 'node:stream';

/** A signed endpoint a client can transfer to/from directly. */
export interface PresignedTarget {
  /** Where the client sends the request. */
  url: string;
  /** For POST-policy uploads: form fields the client must include with the file. */
  fields?: Record<string, string>;
  /** Seconds until the signature expires. */
  expiresIn: number;
}

export interface StatResult {
  size: number;
  etag: string;
  contentType?: string;
  lastModified: Date;
}

export interface PresignedGetOptions {
  expiresIn: number;
  /** Sets response-content-disposition so downloads keep a friendly filename. */
  downloadFilename?: string;
}

export interface PresignedPostOptions {
  expiresIn: number;
  /** Hard upper bound enforced by the store via content-length-range. */
  maxSize: number;
  contentType?: string;
}

export interface PutObjectOptions {
  size?: number;
  contentType?: string;
}

/**
 * Object-storage abstraction. The MinIO implementation lives in
 * `object-storage.service.ts`; consumers depend only on this interface (via the
 * `OBJECT_STORAGE` token) so the backend — MinIO, S3, R2, GCS — can be swapped
 * without touching callers.
 */
export interface ObjectStorage {
  // ── Presigned (external, out-of-process clients) ──
  presignedPutUrl(
    key: string,
    opts: { expiresIn: number },
  ): Promise<PresignedTarget>;
  presignedPostPolicy(
    key: string,
    opts: PresignedPostOptions,
  ): Promise<PresignedTarget>;
  presignedGetUrl(
    key: string,
    opts: PresignedGetOptions,
  ): Promise<PresignedTarget>;

  // ── Direct SDK access (in-process callers) ──
  putObject(
    key: string,
    body: Readable | Buffer,
    opts?: PutObjectOptions,
  ): Promise<{ etag: string }>;
  getObjectStream(key: string): Promise<Readable>;
  statObject(key: string): Promise<StatResult>;
  objectExists(key: string): Promise<boolean>;
  removeObject(key: string): Promise<void>;

  // ── Provisioning ──
  ensureBucket(): Promise<void>;
  bucketName(): string;
}
