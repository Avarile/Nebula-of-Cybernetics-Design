import type { FileRow } from '../../infrastructure/database/schema/file.schema';

// Principal now lives in src/common; kept re-exported under the domain name.
export type { Principal as FilePrincipal } from '../../common/principal';
export { SYSTEM_PRINCIPAL } from '../../common/principal';

/** Public-facing file metadata — what the API and service return. */
export interface FileMetadata {
  id: string;
  ownerId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  checksumSha256: string | null;
  status: FileRow['status'];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Maps a raw DB row to the public metadata shape. */
export function toFileMetadata(row: FileRow): FileMetadata {
  return {
    id: row.id,
    ownerId: row.ownerId,
    filename: row.originalFilename,
    mimeType: row.mimeType,
    size: row.size,
    checksumSha256: row.checksumSha256,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
