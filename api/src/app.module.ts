import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import type { AuthConfig } from './config/configurations/auth.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './features/authorization/permissions.guard';
import { CacheModule } from './infrastructure/cache/cache.module';
import { RedisThrottlerStorage } from './infrastructure/cache/redis-throttler.storage';
import { SessionCacheModule } from './infrastructure/cache/session/session-cache.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ExceptionsModule } from './infrastructure/exceptions';
import { FileManageModule } from './infrastructure/file-manage/file-manage.module';
import { HealthModule } from './infrastructure/health/health.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { ObservabilityModule } from './infrastructure/observability/sentry.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { SearchEngineModule } from './infrastructure/search-engine/search-engine.module';
import { AuthModule } from './features/auth/auth.module';
import { AuthorizationModule } from './features/authorization/authorization.module';
import { ContactsModule } from './features/contacts/contacts.module';
import { KnowledgeModule } from './features/knowledge/knowledge.module';
import { FinanceModule } from './features/finance/finance.module';
import { NotificationsModule } from './features/notifications/notifications.module';
import { ProjectsModule } from './features/projects/projects.module';
import { SchedulingModule } from './features/scheduling/scheduling.module';
import { DocumentIngestModule } from './features/document-ingest/document-ingest.module';
import { FileProcessorModule } from './features/file-processor/file-processor.module';
import { MailboxModule } from './features/mailbox/mailbox.module';
import { MastraModule } from './features/mastra/mastra.module';
import { SearchServiceModule } from './features/search-service/search-service.module';
import { AttachmentsModule } from './features/shared/attachments.module';
import { SharedModule } from './features/shared/shared.module';
import { SystemModule } from './features/system/system.module';
import { UsersModule } from './features/users/users.module';

/**
 * Composition root. Import order is load-bearing:
 *  - ObservabilityModule (Sentry) is first so instrumentation wraps everything.
 *  - MastraModule is last because its catch-all controller would otherwise
 *    intercept unrelated routes.
 *
 * Global guards run in registration order: throttle → authenticate → authorize.
 */
@Module({
  imports: [
    ObservabilityModule,
    ConfigModule,
    // Redis-backed storage, not the default in-process Map: with N replicas
    // the effective limit was N x THROTTLE_LIMIT and it reset on every deploy,
    // which mattered most on the credential-brute-force endpoints that
    // deliberately carry tight per-route limits.
    ThrottlerModule.forRootAsync({
      imports: [CacheModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService, storage: RedisThrottlerStorage) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return {
          throttlers: [
            { ttl: auth.throttleTtl * 1000, limit: auth.throttleLimit },
          ],
          storage,
        };
      },
    }),

    LoggerModule,
    ExceptionsModule,
    DatabaseModule,
    CacheModule,
    SessionCacheModule,
    QueueModule,
    FileManageModule,
    SearchEngineModule,
    HealthModule,

    // Feature modules.
    AuthModule,
    AuthorizationModule,
    UsersModule,
    FileProcessorModule,
    // Cross-cutting (tags, comments, attachments, activity) — before the
    // capability modules that build on it.
    SharedModule,
    AttachmentsModule,
    ContactsModule,
    SearchServiceModule,
    SystemModule,
    KnowledgeModule,
    ProjectsModule,
    NotificationsModule,
    // After NotificationsModule and UsersModule: the reminder handler writes
    // into the notification outbox.
    SchedulingModule,
    FinanceModule,
    MailboxModule,
    DocumentIngestModule,

    // Mastra AI — must remain last.
    MastraModule,
  ],
  providers: [
    // Validates every handler param typed as a `createZodDto` class, throwing the
    // app's AppException(VALIDATION_FAILED) → ErrorEnvelope. Non-DTO params pass
    // through untouched.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Last in the chain: throttle -> authenticate -> authorize by role ->
    // authorize by permission. A route with no @RequirePermission passes
    // straight through, so this is additive.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
