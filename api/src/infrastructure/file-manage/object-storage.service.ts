import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import type { StorageConfig } from '../../config/configurations/storage.config';
import { MINIO_CLIENT } from './minio.constants';
import type {
  ObjectStorage,
  PresignedGetOptions,
  PresignedPostOptions,
  PresignedTarget,
  PutObjectOptions,
  StatResult,
} from './object-storage.interface';

/**
 * Build an RFC 6266 / RFC 5987 `Content-Disposition` value.
 *
 * The previous version stripped `"` and nothing else, which read like a
 * sanitiser without being one: CR, LF, `;` and every non-ASCII byte passed
 * straight through into a response header. Not exploitable today — the MinIO
 * SDK URL-encodes this into the presigned query string — but the safety of the
 * whole thing rested on that incidental encoding rather than on this function.
 *
 * An ASCII-only `filename` covers old clients; `filename*` carries the real name.
 */
function contentDisposition(filename: string): string {
  const collapsed = filename.replace(/[\r\n]+/g, ' ').trim() || 'download';
  // Anything outside a conservative ASCII set becomes `_` in the fallback.
  const ascii = collapsed.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(collapsed)}`;
}

/**
 * MinIO-backed implementation of {@link ObjectStorage}. Translates the generic,
 * store-agnostic interface into `minio` SDK calls against the configured bucket.
 */
@Injectable()
export class ObjectStorageService implements ObjectStorage {
  private readonly bucket: string;
  private readonly region: string;
  private readonly defaultExpiry: number;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    config: ConfigService,
  ) {
    const storage = config.getOrThrow<StorageConfig>('storage');
    this.bucket = storage.bucket;
    this.region = storage.region;
    this.defaultExpiry = storage.presignExpirySeconds;
  }

  bucketName(): string {
    return this.bucket;
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, this.region);
    }
  }

  async presignedPutUrl(
    key: string,
    opts: { expiresIn: number },
  ): Promise<PresignedTarget> {
    const expiresIn = opts.expiresIn || this.defaultExpiry;
    const url = await this.client.presignedPutObject(
      this.bucket,
      key,
      expiresIn,
    );
    return { url, expiresIn };
  }

  async presignedPostPolicy(
    key: string,
    opts: PresignedPostOptions,
  ): Promise<PresignedTarget> {
    const expiresIn = opts.expiresIn || this.defaultExpiry;
    const policy = this.client.newPostPolicy();
    policy.setBucket(this.bucket);
    policy.setKey(key);
    policy.setExpires(new Date(Date.now() + expiresIn * 1000));
    // Enforce the size cap at the edge — MinIO rejects out-of-range uploads.
    policy.setContentLengthRange(1, opts.maxSize);
    if (opts.contentType) {
      policy.setContentType(opts.contentType);
    }
    const result = await this.client.presignedPostPolicy(policy);
    return { url: result.postURL, fields: result.formData, expiresIn };
  }

  async presignedGetUrl(
    key: string,
    opts: PresignedGetOptions,
  ): Promise<PresignedTarget> {
    const expiresIn = opts.expiresIn || this.defaultExpiry;
    const respHeaders: Record<string, string> = {};
    if (opts.downloadFilename) {
      respHeaders['response-content-disposition'] = contentDisposition(
        opts.downloadFilename,
      );
    }
    const url = await this.client.presignedGetObject(
      this.bucket,
      key,
      expiresIn,
      respHeaders,
    );
    return { url, expiresIn };
  }

  async putObject(
    key: string,
    body: Readable | Buffer,
    opts?: PutObjectOptions,
  ): Promise<{ etag: string }> {
    const metaData = opts?.contentType
      ? { 'Content-Type': opts.contentType }
      : undefined;
    const info = await this.client.putObject(
      this.bucket,
      key,
      body,
      opts?.size,
      metaData,
    );
    return { etag: info.etag };
  }

  async getObjectStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  async statObject(key: string): Promise<StatResult> {
    const stat = await this.client.statObject(this.bucket, key);
    return {
      size: stat.size,
      etag: stat.etag,
      contentType: stat.metaData?.['content-type'],
      lastModified: stat.lastModified,
    };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }
}
