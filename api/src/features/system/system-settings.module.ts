import { Module } from '@nestjs/common';
import { CacheModule } from '../../infrastructure/cache/cache.module';
import { SystemAuditModule } from './system-audit.module';
import { SystemSettingsRepository } from './system-settings.repository';
import { SystemSettingsService } from './system-settings.service';

/**
 * Settings alone, separable from the rest of `SystemModule`.
 *
 * Extracted for the same reason `SystemAuditModule` was: a consumer that only
 * needs to read a setting should not have to import the queue, crypto and email
 * dependencies that the rest of the system feature carries. `UsersModule` reads
 * settings to resolve preference defaults, and `UsersModule` is on the path of
 * every authenticated request.
 */
@Module({
  imports: [CacheModule, SystemAuditModule],
  providers: [SystemSettingsRepository, SystemSettingsService],
  exports: [SystemSettingsService, SystemSettingsRepository],
})
export class SystemSettingsModule {}
