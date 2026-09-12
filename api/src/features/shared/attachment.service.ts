import { Injectable } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { EntityAttachmentRow } from '../../infrastructure/database/schema/shared.schema';
import { FileService } from '../file-processor/file.service';
import { ActivityService } from './activity.service';
import { AttachmentRepository } from './attachment.repository';
import type { AttachFileDto } from './dto/attachment.dto';
import { EntityAccessRegistry } from './entity-access.registry';

export interface PublicAttachment {
  id: string;
  entityType: EntityAttachmentRow['entityType'];
  entityId: string;
  fileId: string;
  label: string | null;
  kind: EntityAttachmentRow['kind'];
  sortOrder: number;
  attachedBy: string | null;
  createdAt: Date;
}

/**
 * Binds files to entities. This is what serves "project documents" — there is
 * no per-feature attachment table.
 *
 * Two authorizations are required to attach, and both are delegated: the caller
 * must be able to read the parent entity ({@link EntityAccessRegistry}) and to
 * read the file (`FileService`, which 404s otherwise). Checking only one would
 * let a caller either smuggle someone else's file onto a record they own, or
 * their own file onto a record they cannot see.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly repo: AttachmentRepository,
    private readonly access: EntityAccessRegistry,
    private readonly files: FileService,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: EntityAttachmentRow): PublicAttachment {
    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      fileId: row.fileId,
      label: row.label ?? null,
      kind: row.kind,
      sortOrder: row.sortOrder,
      attachedBy: row.attachedBy ?? null,
      createdAt: row.createdAt,
    };
  }

  async attach(
    dto: AttachFileDto,
    principal: Principal,
  ): Promise<PublicAttachment> {
    await this.assertCanReadParent(dto.entityType, dto.entityId, principal);

    // Throws FILE_NOT_FOUND when the caller may not read it, which is also the
    // right answer for "exists but is not yours".
    const file = await this.files.getMetadata(dto.fileId, principal);
    if (file.status !== 'AVAILABLE') {
      throw this.errors.create(ErrorCode.FILE_INVALID_STATE, {
        message: `File is ${file.status}; only AVAILABLE files can be attached`,
      });
    }

    if (await this.repo.findPair(dto.entityType, dto.entityId, dto.fileId)) {
      throw this.errors.create(ErrorCode.ATTACHMENT_EXISTS);
    }

    const row = await this.repo.create({
      entityType: dto.entityType,
      entityId: dto.entityId,
      fileId: dto.fileId,
      label: dto.label,
      kind: dto.kind,
      sortOrder: dto.sortOrder,
      attachedBy: userIdOrNull(principal),
    });

    await this.activity.recordSafe({
      principal,
      entityType: this.activityEntityType(dto.entityType),
      entityId: dto.entityId,
      action: 'attachment.added',
      summary: dto.label ?? file.filename,
    });
    return this.toPublic(row);
  }

  async list(
    entityType: EntityAttachmentRow['entityType'],
    entityId: string,
    page: number,
    limit: number,
    principal: Principal,
  ) {
    await this.assertCanReadParent(entityType, entityId, principal);
    const { rows, total } = await this.repo.listForEntity(
      entityType,
      entityId,
      page,
      limit,
    );
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  async detach(id: string, principal: Principal): Promise<void> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.ATTACHMENT_NOT_FOUND);
    await this.assertCanReadParent(row.entityType, row.entityId, principal);
    await this.repo.softDelete(id);
    await this.activity.recordSafe({
      principal,
      entityType: this.activityEntityType(row.entityType),
      entityId: row.entityId,
      action: 'attachment.removed',
    });
  }

  /** Whether any live attachment still points at a file (orphan sweep). */
  async isReferenced(fileId: string): Promise<boolean> {
    return (await this.repo.countReferences(fileId)) > 0;
  }

  private async assertCanReadParent(
    entityType: string,
    entityId: string,
    principal: Principal,
  ): Promise<void> {
    if (!(await this.access.canRead(entityType, entityId, principal))) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: 'Record not found',
      });
    }
  }

  /**
   * `attachable_type` and `activity_entity_type` overlap but are not the same
   * enum — `transaction` and `contact_company` exist in both, `goal` only in
   * activity. Narrowing here keeps the mismatch in one place.
   */
  private activityEntityType(
    entityType: EntityAttachmentRow['entityType'],
  ):
    | 'project'
    | 'task'
    | 'knowledge'
    | 'contact'
    | 'contact_company'
    | 'invoice'
    | 'transaction' {
    return entityType;
  }
}
