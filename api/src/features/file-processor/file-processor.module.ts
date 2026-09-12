import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { Module } from '@nestjs/common';
import { INGEST_DOCUMENT_QUEUE } from '../document-ingest/document-ingest.constants';
import { FILE_PROCESSING_QUEUE } from './file.constants';
import { FileController } from './file.controller';
import { FileRepository } from './file.repository';
import { FileService } from './file.service';
import { FileProcessingProcessor } from './processors/file-processing.processor';
import { FileReconciliationScheduler } from './schedulers/file-reconciliation.scheduler';

/**
 * File-processor feature. Exposes the external REST API (FileController) and the
 * internal FileService (for agents / pipeline modules — exported). Registers the
 * `file-processing` BullMQ queue consumed by FileProcessingProcessor, plus a
 * producer-only registration of `document-ingest` (consumed by
 * DocumentIngestModule) so FileProcessingProcessor can enqueue ingestion jobs
 * without importing DocumentIngestModule.
 *
 * Depends on the global DatabaseModule (DRIZZLE), FileManageModule
 * (OBJECT_STORAGE), and QueueModule (BullMQ connection).
 */
@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: FILE_PROCESSING_QUEUE }),
    BullModule.registerQueue({ name: INGEST_DOCUMENT_QUEUE }),
  ],
  controllers: [FileController],
  providers: [
    FileService,
    FileRepository,
    FileProcessingProcessor,
    FileReconciliationScheduler,
  ],
  exports: [FileService],
})
export class FileProcessorModule {}
