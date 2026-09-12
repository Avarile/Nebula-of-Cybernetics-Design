import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';

/**
 * File processing/availability lifecycle. Deletion is orthogonal and handled by
 * the shared `isDeleted` / `deletedAt` soft-delete columns from `baseColumns`.
 *  - PENDING     — metadata row created; awaiting the client's direct upload.
 *  - AVAILABLE   — upload verified; safe to hand out download URLs.
 *  - QUARANTINED — async verification found a declared-vs-actual mismatch.
 */
export const fileStatus = pgEnum('file_status', [
  'PENDING',
  'AVAILABLE',
  'QUARANTINED',
]);

/**
 * File metadata — the source of truth for objects stored in MinIO. MinIO holds
 * the bytes; this table holds ownership, declared/verified metadata, integrity
 * checksum, and lifecycle state. `objectKey` is content-addressed when a
 * checksum is known so identical content maps to a single physical object.
 */
export const files = pgTable(
  'files',
  {
    ...baseColumns,
    ownerId: uuid('owner_id'), // nullable: system / agent-owned files
    bucket: varchar('bucket', { length: 63 }).notNull(),
    objectKey: varchar('object_key', { length: 1024 }).notNull(),
    originalFilename: varchar('original_filename', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }), // null until known
    status: fileStatus('status').notNull().default('PENDING'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('files_owner_idx').on(t.ownerId),
    index('files_checksum_idx').on(t.checksumSha256),
    index('files_status_created_idx').on(t.status, t.createdAt),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
