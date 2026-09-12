import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { FileService } from '../file-processor/file.service';
import { SearchRecordService } from '../search-service/search-record.service';
import { DocumentExtractionService } from './document-extraction.service';
import { chunkText } from './chunk.util';
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_CHUNK_OVERLAP,
  DOCUMENT_CHUNK_SIZE,
  INGEST_DOCUMENT_JOB,
  INGEST_DOCUMENT_QUEUE,
  MAX_EXTRACTED_CHARS,
  chunkExternalId,
} from './document-ingest.constants';
import { haltWorkerIfApiOnly } from '../../infrastructure/queue/worker-role';

@Processor(INGEST_DOCUMENT_QUEUE)
export class DocumentIngestProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(DocumentIngestProcessor.name);

  constructor(
    private readonly files: FileService,
    private readonly extraction: DocumentExtractionService,
    private readonly records: SearchRecordService,
  ) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(job: Job): Promise<void> {
    if (job.name !== INGEST_DOCUMENT_JOB) return;
    const { fileId: id } = job.data as { fileId: string };
    try {
      await this.ingest(job);
    } catch (error) {
      // Record the failure on the file itself. Previously the job simply
      // exhausted its retries and vanished: the `files` row stayed AVAILABLE,
      // no search record was ever written, and the user saw a successfully
      // uploaded document the agent could never find.
      await this.files
        .markIngestFailed(id, asMessage(error))
        .catch((markError: unknown) =>
          this.logger.error(
            `Could not record ingest failure for ${id}: ${asMessage(markError)}`,
          ),
        );
      throw error;
    }
  }

  private async ingest(job: Job): Promise<void> {
    const { fileId } = job.data as { fileId: string };
    // Internal pipeline read, so it acts as the system principal instead of
    // impersonating the file's owner. `FileService.loadReadable` grants `system`
    // explicitly, so this no longer relies on an ownerless row happening to
    // match a null owner id. The document's `ownerUserId` still comes from the
    // file row below, not from the principal.
    const meta = await this.files.getMetadata(fileId, SYSTEM_PRINCIPAL);
    const stream = await this.files.getContentStream(fileId, SYSTEM_PRINCIPAL);
    const { text, title } = await this.extraction.extract(
      meta.mimeType,
      stream,
    );
    const conversationId =
      typeof meta.metadata?.conversationId === 'string'
        ? meta.metadata.conversationId
        : undefined;

    const truncated = text.length > MAX_EXTRACTED_CHARS;
    const usable = truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text;
    if (truncated) {
      this.logger.warn(
        `File ${fileId} extracted ${text.length} characters; indexing the first ` +
          `${MAX_EXTRACTED_CHARS} only.`,
      );
    }

    const chunks = chunkText(usable, {
      size: DOCUMENT_CHUNK_SIZE,
      overlap: DOCUMENT_CHUNK_OVERLAP,
    });
    if (chunks.length === 0) {
      this.logger.warn(`File ${fileId} produced no extractable text`);
      return;
    }

    // One record per chunk, each with a deterministic business key so a
    // re-ingest replaces its predecessor in place rather than duplicating.
    await this.records.persist(
      DOCUMENTS_COLLECTION,
      chunks.map((chunk) => ({
        externalId: chunkExternalId(fileId, chunk.index),
        document: {
          title: title ?? meta.filename,
          text: chunk.text,
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          fileId,
          mimeType: meta.mimeType,
          ownerUserId: meta.ownerId ?? '',
          ...(conversationId ? { conversationId } : {}),
        },
      })),
    );

    // A shorter document leaves stale chunks behind from the previous run;
    // they are still owned by the same file, so drop them explicitly.
    await this.removeStaleChunks(fileId, chunks.length);

    this.logger.log(
      `Ingested file ${fileId} as ${chunks.length} chunk(s) into "${DOCUMENTS_COLLECTION}"`,
    );
  }

  /**
   * Delete chunk records beyond the current chunk count.
   *
   * Re-ingesting a file that got shorter would otherwise leave the tail of the
   * previous run searchable — content the document no longer contains.
   */
  private async removeStaleChunks(fileId: string, keep: number): Promise<void> {
    // Records written before chunking existed are keyed by the bare `fileId`
    // and hold the whole document. A re-ingest writes `fileId#0…` instead, so
    // without this the pre-chunking record survives untouched and keeps serving
    // stale full-document hits alongside the new excerpts.
    await this.records
      .remove(DOCUMENTS_COLLECTION, fileId)
      .catch(() => undefined);

    for (let index = keep; index < keep + STALE_CHUNK_PROBE; index++) {
      try {
        await this.records.remove(
          DOCUMENTS_COLLECTION,
          chunkExternalId(fileId, index),
        );
      } catch {
        // Not found: no chunk at this index, so there is no tail to clean.
        return;
      }
    }
  }
}

/**
 * How far past the current chunk count to look for leftovers. A document
 * shrinking by more than this in one re-ingest leaves a few stale chunks, which
 * the next shorter re-ingest continues to clean.
 */
const STALE_CHUNK_PROBE = 50;

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
