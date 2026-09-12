import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  files,
  type FileRow,
  type NewFileRow,
} from '../../infrastructure/database/schema/file.schema';

/** Repository for the `files` table — domain queries over the base CRUD. */
@Injectable()
export class FileRepository extends BaseRepository<typeof files> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, files);
  }

  /**
   * An already-stored, available object with this content hash, owned by the
   * SAME principal (for dedup).
   *
   * The owner and soft-delete predicates are load-bearing, not tidiness. Without
   * the owner scope, anyone who knew (or could guess) the SHA-256 of another
   * user's file got a fully-owned row pointing at it and could download it
   * immediately — and `initiateUpload`'s `{ deduplicated: true }` answer made
   * the hash space probe-able without uploading a byte. Without the
   * `isDeleted` predicate, a soft-deleted file still counts as dedup-able
   * content, so "deleting" a file resurrected it under the next uploader.
   */
  async findAvailableByChecksum(
    checksum: string,
    ownerId: string | null,
  ): Promise<FileRow | null> {
    const rows = await this.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.checksumSha256, checksum),
          eq(files.status, 'AVAILABLE'),
          eq(files.isDeleted, false),
          ownerId === null ? isNull(files.ownerId) : eq(files.ownerId, ownerId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Paginated, owner-scoped listing (soft-deleted rows excluded). */
  async findByOwner(
    ownerId: string | null,
    page: number,
    limit: number,
    filters: { status?: FileRow['status']; mimeType?: string },
  ): Promise<{ rows: FileRow[]; total: number }> {
    const conditions = [
      ownerId === null ? isNull(files.ownerId) : eq(files.ownerId, ownerId),
      eq(files.isDeleted, false),
    ];
    if (filters.status) conditions.push(eq(files.status, filters.status));
    if (filters.mimeType) conditions.push(eq(files.mimeType, filters.mimeType));
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(files)
      .where(where)
      .orderBy(desc(files.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const totals = await this.db
      .select({ value: count() })
      .from(files)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** PENDING rows whose upload never completed before the cutoff. */
  async findStalePending(olderThan: Date): Promise<FileRow[]> {
    return this.db
      .select()
      .from(files)
      .where(and(eq(files.status, 'PENDING'), lt(files.createdAt, olderThan)));
  }

  /**
   * Soft-deleted rows past their retention window, eligible for object purge +
   * hard-delete.
   *
   * The cutoff is the point. Without it the hourly sweep hard-deleted every
   * soft-deleted row on its next pass — so "soft delete" meant an irrecoverable
   * delete within the hour, with the row that would explain what happened gone
   * too. The search-service already does this properly
   * (`SEARCH_PURGE_AFTER_DAYS` + a converged-in-Meili gate); this brings files
   * in line.
   */
  async findPurgeable(cutoff: Date, limit = 500): Promise<FileRow[]> {
    return this.db
      .select()
      .from(files)
      .where(and(eq(files.isDeleted, true), lt(files.deletedAt, cutoff)))
      .limit(limit);
  }

  /** Transition status (with an optional column patch); returns the new row. */
  async markStatus(
    id: string,
    status: FileRow['status'],
    patch: Partial<NewFileRow> = {},
  ): Promise<FileRow | null> {
    const rows = await this.db
      .update(files)
      .set({ status, ...patch })
      .where(eq(files.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(files)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(files.id, id));
  }

  /** Count of live (non-deleted) rows sharing an object — purge gate. */
  async countLiveReferences(objectKey: string): Promise<number> {
    const totals = await this.db
      .select({ value: count() })
      .from(files)
      .where(and(eq(files.objectKey, objectKey), eq(files.isDeleted, false)));
    return Number(totals[0]?.value ?? 0);
  }

  /**
   * Hard-delete a soft-deleted row and report whether its object is now
   * unreferenced — in one transaction.
   *
   * The sweep used to count references and then delete the object in two
   * separate steps. A `tryDedup` landing between them produced a live,
   * AVAILABLE file row whose bytes had just been removed: the download URL
   * resolved and then 404'd. Doing both under one transaction, with the count
   * taken after the row is gone, closes that window.
   */
  async purgeAndCheckOrphan(
    id: string,
    objectKey: string,
  ): Promise<{ objectOrphaned: boolean }> {
    return this.db.transaction(async (tx) => {
      await tx.delete(files).where(eq(files.id, id));
      const totals = await tx
        .select({ value: count() })
        .from(files)
        .where(and(eq(files.objectKey, objectKey), eq(files.isDeleted, false)));
      return { objectOrphaned: Number(totals[0]?.value ?? 0) === 0 };
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.delete(files).where(eq(files.id, id));
  }
}
