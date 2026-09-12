import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { INGEST_DOCUMENT_JOB } from '../../document-ingest/document-ingest.constants';
import { FILE_PROCESS_JOB, FILE_RECONCILE_JOB } from '../file.constants';
import { FileProcessingProcessor } from './file-processing.processor';

// Test doubles are intentionally loosely typed.
function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'f1',
    ownerId: 'user-1',
    bucket: 'cybernetics',
    objectKey: 'uploads/abc',
    originalFilename: 'file.bin',
    mimeType: 'application/octet-stream',
    size: 10,
    checksumSha256: null,
    status: 'AVAILABLE',
    metadata: {},
    isDeleted: false,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Mirrors the real `getObjectStream(): Promise<Readable>` contract: an
 * async-iterable of Buffer *chunks*. (A bare Buffer is itself byte-iterable —
 * `for await` over one would yield individual octets, not chunks — so tests
 * must not resolve `getObjectStream` with a raw Buffer.)
 */
function streamOf(content: string | Buffer): Readable {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Readable.from([buf]);
}

function sha256Of(content: string | Buffer): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha256').update(buf).digest('hex');
}

describe('FileProcessingProcessor', () => {
  let repo: any;
  let storage: any;
  let ingestQueue: any;
  let proc: FileProcessingProcessor;

  const config = {
    getOrThrow: () => ({ pendingTtlSeconds: 3600, purgeAfterDays: 30 }),
  } as unknown as ConfigService;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      markStatus: jest.fn().mockResolvedValue({}),
      findStalePending: jest.fn().mockResolvedValue([]),
      softDelete: jest.fn().mockResolvedValue(undefined),
      findPurgeable: jest.fn().mockResolvedValue([]),
      countLiveReferences: jest.fn().mockResolvedValue(0),
      hardDelete: jest.fn().mockResolvedValue(undefined),
      purgeAndCheckOrphan: jest
        .fn()
        .mockResolvedValue({ objectOrphaned: true }),
    };
    storage = {
      getObjectStream: jest.fn(),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
    ingestQueue = { add: jest.fn().mockResolvedValue(undefined) };
    proc = new FileProcessingProcessor(
      repo as never,
      storage as never,
      config as never,
      ingestQueue as never,
    );
  });

  describe('process() dispatch', () => {
    it('does nothing for an unrecognized job name', async () => {
      await proc.process({ name: 'not-a-real-job', data: {} } as never);
      expect(repo.findById).not.toHaveBeenCalled();
      expect(repo.findStalePending).not.toHaveBeenCalled();
    });

    it('dispatches reconcile-files to expire stale rows and purge dereferenced ones', async () => {
      repo.findStalePending.mockResolvedValueOnce([{ id: 'stale-1' }]);
      repo.findPurgeable.mockResolvedValueOnce([
        { id: 'purge-1', objectKey: 'uploads/dead' },
      ]);
      await proc.process({ name: FILE_RECONCILE_JOB, data: {} } as never);
      expect(repo.softDelete).toHaveBeenCalledWith('stale-1');
      // Row delete + reference count happen in one transaction now, so the
      // object cannot be removed out from under a concurrent dedup.
      expect(repo.purgeAndCheckOrphan).toHaveBeenCalledWith(
        'purge-1',
        'uploads/dead',
      );
      expect(storage.removeObject).toHaveBeenCalledWith('uploads/dead');
    });

    it('only purges rows past the retention window', async () => {
      repo.findStalePending.mockResolvedValueOnce([]);
      repo.findPurgeable.mockResolvedValueOnce([]);
      await proc.process({ name: FILE_RECONCILE_JOB, data: {} } as never);
      // 30 days back, not "everything soft-deleted".
      const cutoff = repo.findPurgeable.mock.calls[0][0] as Date;
      const daysAgo = (Date.now() - cutoff.getTime()) / 86_400_000;
      expect(daysAgo).toBeCloseTo(30, 0);
    });

    it('leaves the object alone when another live row still references it', async () => {
      repo.findStalePending.mockResolvedValueOnce([]);
      repo.findPurgeable.mockResolvedValueOnce([
        { id: 'purge-2', objectKey: 'sha256/ab/cd/shared' },
      ]);
      repo.purgeAndCheckOrphan.mockResolvedValueOnce({ objectOrphaned: false });
      await proc.process({ name: FILE_RECONCILE_JOB, data: {} } as never);
      expect(storage.removeObject).not.toHaveBeenCalled();
    });
  });

  describe('processFile', () => {
    it('does nothing when the file row does not exist', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(storage.getObjectStream).not.toHaveBeenCalled();
    });

    it('does nothing when the file is not already AVAILABLE', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ status: 'PENDING' }));
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(storage.getObjectStream).not.toHaveBeenCalled();
    });

    it('quarantines on checksum mismatch and does not enqueue ingestion', async () => {
      repo.findById.mockResolvedValueOnce(
        makeRow({ checksumSha256: '0'.repeat(64), mimeType: 'text/markdown' }),
      );
      storage.getObjectStream.mockResolvedValueOnce(streamOf('hello'));
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(repo.markStatus).toHaveBeenCalledWith(
        'f1',
        'QUARANTINED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            quarantineReason: 'checksum-mismatch',
          }),
        }),
      );
      expect(ingestQueue.add).not.toHaveBeenCalled();
    });

    it('quarantines on MIME/magic-byte mismatch and does not enqueue ingestion', async () => {
      repo.findById.mockResolvedValueOnce(
        makeRow({ mimeType: 'text/markdown', checksumSha256: null }),
      );
      const pngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      storage.getObjectStream.mockResolvedValueOnce(streamOf(pngBytes));
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(repo.markStatus).toHaveBeenCalledWith(
        'f1',
        'QUARANTINED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            quarantineReason: 'mime-mismatch',
          }),
        }),
      );
      expect(ingestQueue.add).not.toHaveBeenCalled();
    });

    it('backfills an undeclared checksum for a non-ingestable MIME type and does not enqueue ingestion', async () => {
      repo.findById.mockResolvedValueOnce(
        makeRow({ mimeType: 'application/octet-stream', checksumSha256: null }),
      );
      storage.getObjectStream.mockResolvedValueOnce(streamOf('hello'));
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(repo.markStatus).toHaveBeenCalledWith(
        'f1',
        'AVAILABLE',
        expect.objectContaining({
          checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(ingestQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues an ingest-document job for an ingestable document that passes integrity', async () => {
      repo.findById.mockResolvedValueOnce(
        makeRow({
          mimeType: 'text/markdown',
          checksumSha256: null,
          ownerId: 'user-1',
        }),
      );
      storage.getObjectStream.mockResolvedValueOnce(streamOf('hello'));
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(ingestQueue.add).toHaveBeenCalledWith(
        'ingest-document',
        { fileId: 'f1', ownerId: 'user-1' },
        expect.any(Object),
      );
      expect(INGEST_DOCUMENT_JOB).toBe('ingest-document');
    });

    it('enqueues an ingest-document job when the checksum was already declared and matches (no backfill needed)', async () => {
      const digest = sha256Of('hello');
      repo.findById.mockResolvedValueOnce(
        makeRow({
          mimeType: 'text/markdown',
          checksumSha256: digest,
          ownerId: 'user-1',
        }),
      );
      storage.getObjectStream.mockResolvedValueOnce(streamOf('hello'));
      await proc.process({
        name: FILE_PROCESS_JOB,
        data: { fileId: 'f1' },
      } as never);
      expect(repo.markStatus).not.toHaveBeenCalled();
      expect(ingestQueue.add).toHaveBeenCalledWith(
        INGEST_DOCUMENT_JOB,
        { fileId: 'f1', ownerId: 'user-1' },
        expect.any(Object),
      );
    });
  });
});
