import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { SearchServiceModule } from '../search-service/search-service.module';
import { EntityAccessRegistry } from '../shared/entity-access.registry';
import { SharedModule } from '../shared/shared.module';
import { SystemModule } from '../system/system.module';
import { KnowledgeAclRepository } from './knowledge-acl.repository';
import { KnowledgeAclService } from './knowledge-acl.service';
import { KnowledgeCollectionBootstrap } from './knowledge-collection.bootstrap';
import { KnowledgeProjectionService } from './knowledge-projection.service';
import { KnowledgeVocabularyController } from './knowledge-vocabulary.controller';
import { KnowledgeVocabularyRepository } from './knowledge-vocabulary.repository';
import { KnowledgeVocabularyService } from './knowledge-vocabulary.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeReviewScheduler } from './schedulers/knowledge-review.scheduler';

/**
 * Knowledge: records, their vocabularies, their access grants and their
 * projection into the search index.
 *
 * Depends on `SearchServiceModule` for the projection — the write path is the
 * existing outbox, so a failed index write is repaired by the reconciliation
 * sweep rather than lost.
 */
@Module({
  imports: [SharedModule, SearchServiceModule, SystemModule],
  controllers: [KnowledgeController, KnowledgeVocabularyController],
  providers: [
    KnowledgeRepository,
    KnowledgeAclRepository,
    KnowledgeVocabularyRepository,
    KnowledgeProjectionService,
    KnowledgeService,
    KnowledgeAclService,
    KnowledgeVocabularyService,
    KnowledgeCollectionBootstrap,
    KnowledgeReviewScheduler,
  ],
  exports: [KnowledgeService, KnowledgeAclService],
})
export class KnowledgeModule implements OnApplicationBootstrap {
  constructor(
    private readonly access: EntityAccessRegistry,
    private readonly knowledge: KnowledgeService,
  ) {}

  onApplicationBootstrap(): void {
    // Until this runs, comments and attachments on knowledge are admin-only.
    this.access.register('knowledge', (id, principal) =>
      this.knowledge.canRead(id, principal),
    );
  }
}
