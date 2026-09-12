import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  entityAttachments,
  type EntityAttachmentRow,
} from '../../infrastructure/database/schema/shared.schema';

@Injectable()
export class AttachmentRepository extends BaseRepository<
  typeof entityAttachments
> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, entityAttachments);
  }

  async findLiveById(id: string): Promise<EntityAttachmentRow | null> {
    const rows = await this.db
      .select()
      .from(entityAttachments)
      .where(
        and(
          eq(entityAttachments.id, id),
          eq(entityAttachments.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findPair(
    entityType: EntityAttachmentRow['entityType'],
    entityId: string,
    fileId: string,
  ): Promise<EntityAttachmentRow | null> {
    const rows = await this.db
      .select()
      .from(entityAttachments)
      .where(
        and(
          eq(entityAttachments.entityType, entityType),
          eq(entityAttachments.entityId, entityId),
          eq(entityAttachments.fileId, fileId),
          eq(entityAttachments.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForEntity(
    entityType: EntityAttachmentRow['entityType'],
    entityId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: EntityAttachmentRow[]; total: number }> {
    const where = and(
      eq(entityAttachments.entityType, entityType),
      eq(entityAttachments.entityId, entityId),
      eq(entityAttachments.isDeleted, false),
    );
    const rows = await this.db
      .select()
      .from(entityAttachments)
      .where(where)
      .orderBy(
        asc(entityAttachments.sortOrder),
        asc(entityAttachments.createdAt),
      )
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(entityAttachments)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * How many live rows still reference a file.
   *
   * This is why `entity_attachments_file_idx` exists: the orphaned-upload sweep
   * must answer "is anything still pointing at this object?" without scanning
   * every table that can hold an attachment.
   */
  async countReferences(fileId: string): Promise<number> {
    const totals = await this.db
      .select({ value: count() })
      .from(entityAttachments)
      .where(
        and(
          eq(entityAttachments.fileId, fileId),
          eq(entityAttachments.isDeleted, false),
        ),
      );
    return Number(totals[0]?.value ?? 0);
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(entityAttachments)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(entityAttachments.id, id));
  }

  /** Takes an executor for the same reason `CommentRepository` does. */
  async softDeleteForEntity(
    entityType: EntityAttachmentRow['entityType'],
    entityId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(entityAttachments)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(entityAttachments.entityType, entityType),
          eq(entityAttachments.entityId, entityId),
          eq(entityAttachments.isDeleted, false),
        ),
      )
      .returning({ id: entityAttachments.id });
    return rows.length;
  }
}
