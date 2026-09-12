import { Module } from '@nestjs/common';
import { RetentionRegistryModule } from '../../infrastructure/retention/retention-registry.module';
import { ActivityController } from './activity.controller';
import { ActivityRepository } from './activity.repository';
import { ActivityService } from './activity.service';
import { AttachmentRepository } from './attachment.repository';
import { CommentController } from './comment.controller';
import { CommentRepository } from './comment.repository';
import { CommentService } from './comment.service';
import { EntityAccessRegistry } from './entity-access.registry';
import { EntityCascadeService } from './entity-cascade.service';
import { TagController } from './tag.controller';
import { TagRepository } from './tag.repository';
import { TagService } from './tag.service';

/**
 * Cross-cutting concerns every capability module builds on: the shared tag
 * vocabulary, polymorphic comments and attachments, the activity feed, and the
 * registry through which feature modules declare how their entities are scoped.
 *
 * A true leaf: it depends on infrastructure and on NO feature module. Every
 * capability module imports this one, so a dependency the other way makes the
 * graph circular (it did, via Users -> Authorization -> Shared -> Users), and a
 * heavy dependency here becomes a transitive dependency of authentication (it
 * did, via FileProcessorModule -> MinIO). Where this module needs a fact from
 * another table — does this user exist? — it queries it directly rather than
 * importing that module's service, and where it needs another module's service,
 * that consumer moves out instead (see `AttachmentsModule`).
 */
@Module({
  imports: [RetentionRegistryModule],
  controllers: [TagController, CommentController, ActivityController],
  providers: [
    EntityAccessRegistry,
    TagRepository,
    TagService,
    CommentRepository,
    CommentService,
    AttachmentRepository,
    ActivityRepository,
    ActivityService,
    EntityCascadeService,
  ],
  exports: [
    EntityAccessRegistry,
    TagService,
    CommentService,
    ActivityService,
    EntityCascadeService,
    // Exported for AttachmentsModule, which owns the service that needs
    // FileService and therefore must live outside this module.
    AttachmentRepository,
  ],
})
export class SharedModule {}
