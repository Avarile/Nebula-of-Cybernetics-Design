import { Module } from '@nestjs/common';
import { ScheduledJobHandlerRegistry } from './job-handler.registry';

/**
 * Provides the single {@link ScheduledJobHandlerRegistry}.
 *
 * A plain module rather than a `@Global()` one, mirroring
 * `RetentionRegistryModule`: the importers are few and naming them keeps the
 * seam visible. Nest caches module instances, so every importer resolves the
 * same registry — which is the point, since the dispatcher and the
 * registrations must meet in one place.
 */
@Module({
  providers: [ScheduledJobHandlerRegistry],
  exports: [ScheduledJobHandlerRegistry],
})
export class JobHandlerRegistryModule {}
