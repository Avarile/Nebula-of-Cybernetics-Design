import { Module } from '@nestjs/common';
import { SystemAuditRepository } from './system-audit.repository';
import { SystemAuditService } from './system-audit.service';

/**
 * The audit trail on its own, so features outside `system` can record to it
 * without importing the whole system feature (and its five admin controllers).
 *
 * Extracted for `MastraModule`, which audits an admin reading a conversation
 * they do not own. Same reasoning as `MastraRepositoriesModule`: both providers
 * depend only on the global `DRIZZLE` token, so this module needs no imports and
 * costs nothing to pull in.
 */
@Module({
  providers: [SystemAuditRepository, SystemAuditService],
  exports: [SystemAuditService],
})
export class SystemAuditModule {}
