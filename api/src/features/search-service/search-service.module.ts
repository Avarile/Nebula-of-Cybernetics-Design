import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { Module } from '@nestjs/common';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';
import { IndexRegistry } from './index-registry';
import { SearchIndexingProcessor } from './processors/search-indexing.processor';
import { RecordController } from './record.controller';
import { SearchPurgeScheduler } from './schedulers/search-purge.scheduler';
import { SearchReconciliationScheduler } from './schedulers/search-reconciliation.scheduler';
import { SearchQueryController } from './search.controller';
import { SEARCH_INDEXING_QUEUE } from './search.constants';
import { SearchMetrics } from './search.metrics';
import { SearchRecordRepository } from './search-record.repository';
import { SearchRecordService } from './search-record.service';
import { SearchStatusController } from './search-status.controller';
import { SearchStatusService } from './search-status.service';

/**
 * Search-service feature: a generic data processor. Admins manage collections
 * and persist records (Postgres = source of truth); everyone queries Meili.
 * Registers the `search-indexing` queue, whose processor applies every index
 * mutation off the request path, plus the two self-registering sweeps that keep
 * the read model converged (reconciliation) and the table bounded (purge).
 *
 * Depends on the global SearchEngineModule (SEARCH_ENGINE), DatabaseModule
 * (DRIZZLE), CacheModule (REDIS_CLIENT, for registry invalidation), and
 * QueueModule.
 */
@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: SEARCH_INDEXING_QUEUE }),
  ],
  controllers: [
    CollectionController,
    RecordController,
    SearchQueryController,
    SearchStatusController,
  ],
  providers: [
    IndexRegistry,
    CollectionRepository,
    SearchRecordRepository,
    SearchMetrics,
    CollectionService,
    SearchRecordService,
    SearchStatusService,
    SearchIndexingProcessor,
    SearchReconciliationScheduler,
    SearchPurgeScheduler,
  ],
  exports: [SearchRecordService, CollectionService, SearchStatusService],
})
export class SearchServiceModule {}
