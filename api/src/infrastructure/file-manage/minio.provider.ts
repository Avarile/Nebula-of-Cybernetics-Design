import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { StorageConfig } from '../../config/configurations/storage.config';
import { MINIO_CLIENT } from './minio.constants';

/**
 * Builds the MinIO client from validated config. MinIO's client is a stateless
 * HTTP client — there is no persistent connection pool to drain, so (unlike the
 * pg pool / ioredis client) no `OnApplicationShutdown` lifecycle is needed.
 */
export const minioClientProvider: Provider = {
  provide: MINIO_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Client => {
    const storage = config.getOrThrow<StorageConfig>('storage');
    return new Client({
      endPoint: storage.endpoint,
      port: storage.port,
      useSSL: storage.useSSL,
      accessKey: storage.accessKey,
      secretKey: storage.secretKey,
      region: storage.region,
    });
  },
};
