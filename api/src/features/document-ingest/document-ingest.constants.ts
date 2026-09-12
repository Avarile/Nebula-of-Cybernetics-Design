import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue-names';

export const DOCUMENTS_COLLECTION = 'documents';
export const INGEST_DOCUMENT_QUEUE = QUEUE_NAMES.documentIngest;
export const INGEST_DOCUMENT_JOB = 'ingest-document';

/**
 * Chunking for extracted document text.
 *
 * Documents used to be stored whole — one unbounded JSONB value and one Meili
 * document per upload, re-copied on every re-index. `FILE_MAX_SIZE` defaults to
 * 50 MB, so this was also the largest single memory and storage cliff in the
 * system, and a whole book as one search hit is poor retrieval besides.
 */
export const DOCUMENT_CHUNK_SIZE = 2_000;
export const DOCUMENT_CHUNK_OVERLAP = 200;

/**
 * Ceiling on extracted text per document.
 *
 * A hard bound on the work one upload can create: at 2 000 characters per chunk
 * this is 1 000 records. Text past it is dropped, and the record says so.
 */
export const MAX_EXTRACTED_CHARS = 2_000_000;

/** Deterministic per-chunk business key, so a re-ingest upserts in place. */
export function chunkExternalId(fileId: string, index: number): string {
  return `${fileId}#${index}`;
}

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MARKDOWN_MIME = 'text/markdown';
export const PLAIN_TEXT_MIME = 'text/plain';

const INGESTABLE = new Set<string>([
  PDF_MIME,
  DOCX_MIME,
  MARKDOWN_MIME,
  PLAIN_TEXT_MIME,
]);

/** True when an uploaded file's MIME should be extracted into a text record. */
export function isIngestableDocMime(mime: string): boolean {
  return INGESTABLE.has(mime);
}

/**
 * Field spec for the `documents` collection. `createdAt`/`updatedAt`/`externalId`
 * are auto-managed by the search-service, so they are intentionally omitted.
 * Scoping is by `ownerUserId`; `conversationId` is stored for provenance/future use.
 */
export function documentsCollectionFields(): FieldSpec[] {
  return [
    { name: 'title', type: 'string', searchable: true },
    { name: 'text', type: 'string', searchable: true },
    // Position of this chunk within its document, so a hit can be ordered and
    // cited rather than being an anonymous fragment.
    { name: 'chunkIndex', type: 'number', filterable: true, sortable: true },
    { name: 'chunkCount', type: 'number' },
    { name: 'fileId', type: 'string', filterable: true },
    { name: 'mimeType', type: 'string', filterable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'conversationId', type: 'string', filterable: true },
  ];
}
