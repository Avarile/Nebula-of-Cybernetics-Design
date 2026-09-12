import { Injectable } from '@nestjs/common';
import {
  isAdmin,
  requireUserId,
  userIdOrNull,
  type Principal,
} from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { CommentRow } from '../../infrastructure/database/schema/shared.schema';
import { ActivityService } from './activity.service';
import { CommentRepository, type CommentQuery } from './comment.repository';
import type { CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import { EntityAccessRegistry } from './entity-access.registry';

export interface PublicComment {
  id: string;
  entityType: CommentRow['entityType'];
  entityId: string;
  parentCommentId: string | null;
  authorUserId: string | null;
  authorKind: CommentRow['authorKind'];
  body: string;
  mentions: string[];
  editedAt: Date | null;
  createdAt: Date;
}

/**
 * Comments on any commentable entity.
 *
 * Readability is entirely the parent's: this service never decides who may see
 * a project, it asks {@link EntityAccessRegistry}. An entity type whose module
 * has not registered a resolver is denied to non-admins, so a new value in the
 * `commentable_type` enum cannot become world-readable by default.
 */
@Injectable()
export class CommentService {
  constructor(
    private readonly repo: CommentRepository,
    private readonly access: EntityAccessRegistry,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: CommentRow): PublicComment {
    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      parentCommentId: row.parentCommentId ?? null,
      authorUserId: row.authorUserId,
      authorKind: row.authorKind,
      body: row.body,
      mentions: row.mentions,
      editedAt: row.editedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  async create(
    dto: CreateCommentDto,
    principal: Principal,
  ): Promise<PublicComment> {
    await this.assertCanReadParent(dto.entityType, dto.entityId, principal);

    if (dto.parentCommentId) {
      const parent = await this.repo.findLiveById(dto.parentCommentId);
      if (
        !parent ||
        parent.entityType !== dto.entityType ||
        parent.entityId !== dto.entityId
      ) {
        throw this.errors.create(ErrorCode.COMMENT_NOT_FOUND, {
          message: 'Parent comment does not belong to this entity',
        });
      }
      // One level of threading: replying to a reply flattens onto its parent,
      // rather than growing a tree the UI cannot render.
      if (parent.parentCommentId) {
        dto = { ...dto, parentCommentId: parent.parentCommentId };
      }
    }

    const mentions = await this.verifyMentions(dto.mentionUserIds);
    const row = await this.repo.create({
      entityType: dto.entityType,
      entityId: dto.entityId,
      parentCommentId: dto.parentCommentId ?? null,
      authorUserId: userIdOrNull(principal),
      authorKind: principal.kind === 'service' ? 'service' : 'user',
      body: dto.body,
      mentions,
    });

    await this.activity.recordSafe({
      principal,
      entityType: dto.entityType,
      entityId: dto.entityId,
      action: 'comment.created',
      summary: row.body.slice(0, 200),
    });
    return this.toPublic(row);
  }

  async list(q: CommentQuery, principal: Principal) {
    await this.assertCanReadParent(q.entityType, q.entityId, principal);
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  /** Only the author may edit their own words; admins may not rewrite them. */
  async update(
    id: string,
    dto: UpdateCommentDto,
    principal: Principal,
  ): Promise<PublicComment> {
    const existing = await this.requireLive(id);
    if (existing.authorUserId !== requireUserId(principal)) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Only the author can edit a comment',
      });
    }
    const row = await this.repo.update(id, {
      body: dto.body,
      editedAt: new Date(),
    });
    if (!row) throw this.errors.create(ErrorCode.COMMENT_NOT_FOUND);
    return this.toPublic(row);
  }

  /** The author or an admin may remove a comment; the row is tombstoned. */
  async remove(id: string, principal: Principal): Promise<void> {
    const existing = await this.requireLive(id);
    const isAuthor =
      principal.kind === 'user' && existing.authorUserId === principal.userId;
    if (!isAuthor && !isAdmin(principal)) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Only the author or an admin can delete a comment',
      });
    }
    await this.repo.softDelete(id);
    await this.activity.recordSafe({
      principal,
      entityType: existing.entityType,
      entityId: existing.entityId,
      action: 'comment.deleted',
    });
  }

  private async requireLive(id: string): Promise<CommentRow> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.COMMENT_NOT_FOUND);
    return row;
  }

  private async assertCanReadParent(
    entityType: CommentRow['entityType'],
    entityId: string,
    principal: Principal,
  ): Promise<void> {
    const allowed = await this.access.canRead(entityType, entityId, principal);
    if (!allowed) {
      // NOT_FOUND rather than FORBIDDEN: telling an unauthorized caller that a
      // record exists is itself a disclosure.
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: 'Record not found',
      });
    }
  }

  /**
   * Keep only ids that name a live user account.
   *
   * A client that invents ids would otherwise have them stored and, once the
   * notification pipeline exists, mailed. Dispatch additionally re-checks that
   * each mentioned user may read the parent entity — existence is necessary,
   * not sufficient.
   */
  private async verifyMentions(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return this.repo.filterLiveUserIds(unique);
  }
}
