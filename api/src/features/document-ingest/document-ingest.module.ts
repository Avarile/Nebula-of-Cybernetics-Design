import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { Module } from '@nestjs/common';
import { FileProcessorModule } from '../file-processor/file-processor.module';
import { SearchServiceModule } from '../search-service/search-service.module';
import { DocumentExtractionService } from './document-extraction.service';
import { DocumentIngestProcessor } from './document-ingest.processor';
import { DocumentsCollectionBootstrap } from './documents-collection.bootstrap';
import { INGEST_DOCUMENT_QUEUE } from './document-ingest.constants';

/**
 * Document-ingest feature: consumes the `document-ingest` BullMQ queue,
 * extracting text from uploaded files (FileProcessorModule) and persisting
 * owner-scoped records into the `documents` search collection
 * (SearchServiceModule). Nothing external calls into this module directly —
 * jobs are the only entry point (a later task enqueues them from
 * file-processing).
 */
@Module({
  imports: [
    FileProcessorModule,
    SearchServiceModule,
    QueueModule,
    BullModule.registerQueue({ name: INGEST_DOCUMENT_QUEUE }),
  ],
  providers: [
    DocumentExtractionService,
    DocumentIngestProcessor,
    DocumentsCollectionBootstrap,
  ],
})
export class DocumentIngestModule {}
