import { Injectable, Logger } from '@nestjs/common';
import type { DataRetentionPolicyRow } from '../database/schema/system.schema';

/** Deletes at most `limit` rows older than `cutoff`; returns how many went. */
export type RetentionPurge = (cutoff: Date, limit: number) => Promise<number>;

type RetentionEntity = DataRetentionPolicyRow['entityType'];

/**
 * Where modules declare how their own rows are purged.
 *
 * Lives in infrastructure rather than in the system feature because both sides
 * need it: `SystemModule` owns the sweep that reads it, and every capability
 * module registers into it. Making it the system feature's property forced
 * `SystemModule` to import the modules whose tables it purges, which dragged
 * MinIO and the file queue into a context that only wanted system settings.
 *
 * The alternative — one retention service importing every repository it might
 * need to sweep — would make an infrastructure concern depend on all seven
 * capability modules, which is exactly backwards. Each module registers its own
 * purge at bootstrap:
 *
 *   registry.register('activity_log', (cutoff, limit) =>
 *     this.activity.purgeOlderThan(cutoff, limit));
 *
 * A policy row whose entity type has no registered purge is **skipped and
 * logged**, never treated as done. Silence there would let an enabled policy
 * appear to run for months while the table grew.
 */
@Injectable()
export class RetentionPurgeRegistry {
  private readonly logger = new Logger(RetentionPurgeRegistry.name);
  private readonly purges = new Map<RetentionEntity, RetentionPurge>();

  register(entityType: RetentionEntity, purge: RetentionPurge): void {
    if (this.purges.has(entityType)) {
      throw new Error(
        `Retention purge for "${entityType}" is already registered`,
      );
    }
    this.purges.set(entityType, purge);
    this.logger.debug(`Registered retention purge for "${entityType}"`);
  }

  get(entityType: RetentionEntity): RetentionPurge | undefined {
    return this.purges.get(entityType);
  }

  registeredTypes(): RetentionEntity[] {
    return [...this.purges.keys()].sort();
  }
}
