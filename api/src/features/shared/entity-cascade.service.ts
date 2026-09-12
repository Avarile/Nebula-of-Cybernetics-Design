import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import type { CommentRow } from '../../infrastructure/database/schema/shared.schema';
import { AttachmentRepository } from './attachment.repository';
import { CommentRepository } from './comment.repository';

/** Entity types that carry both comments and attachments. */
type CascadableType = CommentRow['entityType'];

/**
 * The application-level cascade the two polymorphic tables need.
 *
 * `comments.entity_id` and `entity_attachments.entity_id` carry no foreign key
 * — that is the accepted cost of making them generic — so nothing in the
 * database removes them when their parent goes away. Deleting a project must
 * therefore call this, or its comments and attachments outlive it as rows
 * nothing can reach and nothing will ever clean up.
 *
 * Every feature that soft-deletes a commentable or attachable entity calls
 * `purgeFor` in the same transaction as the delete.
 */
@Injectable()
export class EntityCascadeService {
  private readonly logger = new Logger(EntityCascadeService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly comments: CommentRepository,
    private readonly attachments: AttachmentRepository,
  ) {}

  /**
   * Soft-delete every comment and attachment hanging off one entity.
   *
   * Soft, not hard: the parent is soft-deleted too, and a hard delete here
   * would destroy the discussion of a record that is still recoverable.
   */
  async purgeFor(
    entityType: CascadableType,
    entityId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<{ comments: number; attachments: number }> {
    const removedComments = await this.comments.softDeleteForEntity(
      entityType,
      entityId,
      executor,
    );
    // `attachable_type` lacks `goal` and `milestone`; those entities can be
    // commented on but never carry files, so there is nothing to purge.
    const removedAttachments = this.isAttachable(entityType)
      ? await this.attachments.softDeleteForEntity(
          entityType,
          entityId,
          executor,
        )
      : 0;

    if (removedComments > 0 || removedAttachments > 0) {
      this.logger.debug(
        `Cascade on ${entityType}:${entityId} removed ${removedComments} comment(s) ` +
          `and ${removedAttachments} attachment(s)`,
      );
    }
    return { comments: removedComments, attachments: removedAttachments };
  }

  private isAttachable(
    entityType: CascadableType,
  ): entityType is 'project' | 'task' | 'knowledge' | 'contact' | 'invoice' {
    return entityType !== 'goal' && entityType !== 'milestone';
  }
}
