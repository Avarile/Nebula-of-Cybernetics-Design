import { Global, Module } from '@nestjs/common';
import { MINIO_CLIENT, OBJECT_STORAGE } from './minio.constants';
import { minioClientProvider } from './minio.provider';
import { ObjectStorageService } from './object-storage.service';

/**
 * MinIO-backed object storage. Exposes the `OBJECT_STORAGE` abstraction (used by
 * the file-processor feature) and the raw `MINIO_CLIENT` (used by the health
 * indicator). Global so any feature can depend on `OBJECT_STORAGE` without a
 * per-module import.
 */
@Global()
@Module({
  providers: [
    minioClientProvider,
    { provide: OBJECT_STORAGE, useClass: ObjectStorageService },
  ],
  exports: [OBJECT_STORAGE, MINIO_CLIENT],
})
export class FileManageModule {}
