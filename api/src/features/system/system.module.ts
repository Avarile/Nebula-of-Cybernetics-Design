import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CacheModule } from '../../infrastructure/cache/cache.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { FeatureFlagController } from './feature-flag.controller';
import { FeatureFlagRepository } from './feature-flag.repository';
import { FeatureFlagService } from './feature-flag.service';
import { RetentionController } from './retention.controller';
import { RetentionRegistryModule } from '../../infrastructure/retention/retention-registry.module';
import { RetentionRepository } from './retention.repository';
import { RetentionService } from './retention.service';
import {
  RetentionProcessor,
  RetentionScheduler,
} from './schedulers/retention.scheduler';
import { SystemEventController } from './system-event.controller';
import { SystemEventRepository } from './system-event.repository';
import { SystemEventService } from './system-event.service';
import { SYSTEM_RETENTION_QUEUE } from './system.constants';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { EmailModule } from '../../infrastructure/email/email.module';
import { SystemAuditModule } from './system-audit.module';
import { ImapConfigController } from './imap-config.controller';
import { ImapConfigRepository } from './imap-config.repository';
import { ImapConfigService } from './imap-config.service';
import { IntegrationCredentialController } from './integration-credential.controller';
import { IntegrationCredentialRepository } from './integration-credential.repository';
import { IntegrationCredentialService } from './integration-credential.service';
import { SmtpConfigController } from './smtp-config.controller';
import { SmtpConfigRepository } from './smtp-config.repository';
import { SmtpConfigService } from './smtp-config.service';
import { SystemAuditController } from './system-audit.controller';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsModule } from './system-settings.module';

/**
 * System-records feature. Admin-only (enforced by the global RolesGuard via
 * @Roles('admin') on each controller). DatabaseModule is global. CacheModule
 * is `@Global()` too, but its providers (`CACHE_MANAGER`) are only registered
 * once something imports it into the module graph — in the full app that's
 * AppModule, but module-subset test contexts (e2e) don't import AppModule, so
 * this module imports CacheModule directly to stay self-sufficient.
 */
@Module({
  imports: [
    CryptoModule,
    CacheModule,
    EmailModule,
    SystemAuditModule,
    SystemSettingsModule,
    RetentionRegistryModule,
    QueueModule,
    BullModule.registerQueue({ name: SYSTEM_RETENTION_QUEUE }),
  ],
  controllers: [
    SystemAuditController,
    SmtpConfigController,
    ImapConfigController,
    IntegrationCredentialController,
    SystemSettingsController,
    FeatureFlagController,
    RetentionController,
    SystemEventController,
  ],
  providers: [
    SmtpConfigRepository,
    SmtpConfigService,
    ImapConfigRepository,
    ImapConfigService,
    IntegrationCredentialRepository,
    IntegrationCredentialService,
    FeatureFlagRepository,
    FeatureFlagService,
    SystemEventRepository,
    SystemEventService,
    RetentionRepository,
    RetentionService,
    RetentionScheduler,
    RetentionProcessor,
  ],
  exports: [
    // Re-exported as a module, not as a bare class: `SystemAuditService` is a
    // provider of SystemAuditModule, and Nest only lets a module export a token
    // it provides or a module it imports. Consumers of SystemModule still
    // resolve SystemAuditService, exactly as before.
    SystemAuditModule,
    // Re-exported as a module for the same reason SystemAuditModule is: Nest
    // only lets a module export a token it provides or a module it imports.
    SystemSettingsModule,
    SmtpConfigService,
    IntegrationCredentialService,
    FeatureFlagService,
    SystemEventService,
  ],
})
export class SystemModule {}
