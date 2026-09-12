import { Module } from '@nestjs/common';
import { RetentionPurgeRegistry } from './retention.registry';

/**
 * Provides the single {@link RetentionPurgeRegistry} instance.
 *
 * A plain module rather than a `@Global()` one: the importers are few and
 * naming them keeps the seam visible. Nest caches module instances, so every
 * importer resolves the same registry — which is the point, since the sweep and
 * the registrations must meet in one place.
 */
@Module({
  providers: [RetentionPurgeRegistry],
  exports: [RetentionPurgeRegistry],
})
export class RetentionRegistryModule {}
