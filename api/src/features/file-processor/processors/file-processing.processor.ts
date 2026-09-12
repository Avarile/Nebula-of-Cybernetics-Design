import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import type { StorageConfig } from '../../../config/configurations/storage.config';
import {
  INGEST_DOCUMENT_JOB,
  INGEST_DOCUMENT_QUEUE,
  isIngestableDocMime,
} from '../../document-ingest/document-ingest.constants';
import { OBJECT_STORAGE } from '../../../infrastructure/file-manage/minio.constants';
import type { ObjectStorage } from '../../../infrastructure/file-manage/object-storage.interface';
import {
  FILE_PROCESS_JOB,
  FILE_PROCESSING_QUEUE,
  FILE_RECONCILE_JOB,
} from '../file.constants';
import { FileRepository } from '../file.repository';
import { isDeclaredMimeMismatch } from '../file.util';
import { haltWorkerIfApiOnly } from '../../../infrastructure/queue/worker-role';

/**
 * Consumes the `file-processing` queue:
 *  - process-file:    verify/backfill SHA-256 + magic-byte check → AVAILABLE or QUARANTINED;
 *                      enqueues `document-ingest` for ingestable MIME types that pass integrity.
 *  - reconcile-files: expire stale PENDING rows; purge unreferenced objects.
 */
@Processor(FILE_PROCESSING_QUEUE)
export class FileProcessingProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(FileProcessingProcessor.name);
  private readonly pendingTtlMs: number;
  private readonly purgeAfterMs: number;

  constructor(
    private readonly repo: FileRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    config: ConfigService,
    @InjectQueue(INGEST_DOCUMENT_QUEUE) private readonly ingestQueue: Queue,
  ) {
    super();
    const cfg = config.getOrThrow<StorageConfig>('storage');
    this.pendingTtlMs = cfg.pendingTtlSeconds * 1000;
    this.purgeAfterMs = cfg.purgeAfterDays * 24 * 60 * 60 * 1000;
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case FILE_PROCESS_JOB: {
        const { fileId } = job.data as { fileId: string };
        await this.processFile(fileId);
        break;
      }
      case FILE_RECONCILE_JOB:
        await this.reconcile();
        break;
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  private async processFile(fileId: string): Promise<void> {
    const row = await this.repo.findById(fileId);
    if (!row || row.status !== 'AVAILABLE') return;

    // Single streaming pass: compute SHA-256 and capture the header bytes.
    const stream = await this.storage.getObjectStream(row.objectKey);
    const hash = createHash('sha256');
    // 64, not 16: the markup signatures ('<!doctype html', a leading BOM plus
    // whitespace, …) need more than sixteen bytes to match reliably.
    const HEAD_BYTES = 64;
    let head: Buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      if (head.length < HEAD_BYTES) {
        head = Buffer.concat([head, buf.subarray(0, HEAD_BYTES - head.length)]);
      }
      hash.update(buf);
    }
    const digest = hash.digest('hex');

    // Integrity: a declared checksum that doesn't match is a hard failure.
    if (row.checksumSha256 && row.checksumSha256 !== digest) {
      await this.repo.markStatus(fileId, 'QUARANTINED', {
        metadata: { ...row.metadata, quarantineReason: 'checksum-mismatch' },
      });
      this.logger.warn(`File ${fileId} quarantined: checksum mismatch`);
      return;
    }

    // Content sniffing: declared MIME must not contradict the magic bytes.
    if (isDeclaredMimeMismatch(row.mimeType, head)) {
      await this.repo.markStatus(fileId, 'QUARANTINED', {
        checksumSha256: row.checksumSha256 ?? digest,
        metadata: { ...row.metadata, quarantineReason: 'mime-mismatch' },
      });
      this.logger.warn(`File ${fileId} quarantined: MIME mismatch`);
      return;
    }

    // Backfill the checksum when it wasn't declared.
    if (!row.checksumSha256) {
      await this.repo.markStatus(fileId, 'AVAILABLE', {
        checksumSha256: digest,
      });
    }

    // Integrity passed — hand ingestable document types to the ingest pipeline.
    if (isIngestableDocMime(row.mimeType)) {
      await this.ingestQueue.add(
        INGEST_DOCUMENT_JOB,
        { fileId, ownerId: row.ownerId },
        {
          // Deduplicated by file id. Without it, re-processing the same file —
          // a retry, a reconcile, a second upload of identical bytes — enqueued
          // another full parse of a document that can be tens of megabytes.
          jobId: `ingest:${fileId}`,
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    }
  }

  private async reconcile(): Promise<void> {
    const cutoff = new Date(Date.now() - this.pendingTtlMs);
    const stale = await this.repo.findStalePending(cutoff);
    for (const row of stale) {
      await this.repo.softDelete(row.id);
    }

    // Only rows past the retention window. Without the cutoff this swept every
    // soft-deleted row on the next hourly pass, making "soft delete" an
    // irrecoverable delete within the hour — and taking the row that would have
    // explained it along too.
    const purgeCutoff = new Date(Date.now() - this.purgeAfterMs);
    const purgeable = await this.repo.findPurgeable(purgeCutoff);
    for (const row of purgeable) {
      // Row delete and reference count in one transaction, so a `tryDedup`
      // cannot claim the object between the check and the removal and end up
      // with a live file row whose bytes are gone.
      const { objectOrphaned } = await this.repo.purgeAndCheckOrphan(
        row.id,
        row.objectKey,
      );
      if (!objectOrphaned) continue;
      try {
        await this.storage.removeObject(row.objectKey);
      } catch (error) {
        // The row is already gone; a failed object delete leaks bytes rather
        // than breaking anything, and the next sweep will not retry it. Logged
        // loudly so it is visible rather than silent.
        this.logger.warn(
          `Orphaned object ${row.objectKey} could not be removed: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Reconciliation: expired ${stale.length} pending, purged ${purgeable.length} terminal rows`,
    );
  }
}
