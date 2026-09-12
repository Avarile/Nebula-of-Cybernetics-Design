import { DocumentIngestProcessor } from './document-ingest.processor';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import {
  DOCUMENTS_COLLECTION,
  INGEST_DOCUMENT_JOB,
} from './document-ingest.constants';

describe('DocumentIngestProcessor', () => {
  const fileRow = {
    id: 'file-1',
    ownerId: 'user-1',
    mimeType: 'text/markdown',
    originalFilename: 'notes.md',
    metadata: { conversationId: 'conv-9' },
  };
  const files = {
    getMetadata: jest.fn().mockResolvedValue(fileRow),
    getContentStream: jest.fn().mockResolvedValue(Buffer.from('# Notes\nbody')),
  };
  const extraction = {
    extract: jest.fn().mockResolvedValue({ text: 'body', title: 'Notes' }),
  };
  const records = {
    persist: jest
      .fn()
      .mockResolvedValue([{ id: 'rec-1', externalId: 'file-1#0' }]),
    // Cleaning the tail of a previous, longer run stops when a chunk is absent.
    remove: jest.fn().mockRejectedValue(new Error('not found')),
  };
  const proc = new DocumentIngestProcessor(
    files as never,
    extraction as never,
    records as never,
  );

  it('reads the file, extracts text, and persists a scoped record', async () => {
    await proc.process({
      name: INGEST_DOCUMENT_JOB,
      data: { fileId: 'file-1', ownerId: 'user-1' },
    } as never);
    // The pipeline reads as the system principal rather than impersonating the
    // file's owner; the record's `ownerUserId` still comes from the file row.
    expect(files.getMetadata).toHaveBeenCalledWith('file-1', SYSTEM_PRINCIPAL);
    expect(files.getContentStream).toHaveBeenCalledWith(
      'file-1',
      SYSTEM_PRINCIPAL,
    );
    expect(extraction.extract).toHaveBeenCalledWith(
      'text/markdown',
      expect.anything(),
    );
    const [collection, inputs] = records.persist.mock.calls[0];
    expect(collection).toBe(DOCUMENTS_COLLECTION);
    // Keyed per chunk, so a re-ingest upserts in place instead of duplicating.
    expect(inputs[0].externalId).toBe('file-1#0');
    expect(inputs[0].document).toMatchObject({
      fileId: 'file-1',
      ownerUserId: 'user-1',
      conversationId: 'conv-9',
      mimeType: 'text/markdown',
      text: 'body',
      chunkIndex: 0,
      chunkCount: 1,
    });
  });

  it('splits a long document into chunk records instead of one huge one', async () => {
    records.persist.mockClear();
    extraction.extract.mockResolvedValueOnce({
      text: 'sentence. '.repeat(2_000),
      title: 'Long',
    });
    await proc.process({
      name: INGEST_DOCUMENT_JOB,
      data: { fileId: 'file-2' },
    } as never);
    const [, inputs] = records.persist.mock.calls[0];
    expect(inputs.length).toBeGreaterThan(1);
    // Every chunk carries its position and the total, so a hit can be cited.
    inputs.forEach((input: never, i: number) => {
      expect((input as { externalId: string }).externalId).toBe(`file-2#${i}`);
      expect(
        (input as { document: { chunkIndex: number; chunkCount: number } })
          .document,
      ).toMatchObject({ chunkIndex: i, chunkCount: inputs.length });
    });
  });

  // Records written before chunking are keyed by the bare fileId and hold the
  // whole document; leaving them would serve stale full-document hits next to
  // the new excerpts.
  it('removes a pre-chunking record for the same file', async () => {
    records.persist.mockClear();
    records.remove.mockClear();
    await proc.process({
      name: INGEST_DOCUMENT_JOB,
      data: { fileId: 'file-legacy' },
    } as never);
    expect(records.remove).toHaveBeenCalledWith(
      DOCUMENTS_COLLECTION,
      'file-legacy',
    );
  });

  it('writes nothing when a document yields no text', async () => {
    records.persist.mockClear();
    extraction.extract.mockResolvedValueOnce({ text: '   ', title: undefined });
    await proc.process({
      name: INGEST_DOCUMENT_JOB,
      data: { fileId: 'file-3' },
    } as never);
    expect(records.persist).not.toHaveBeenCalled();
  });
});
