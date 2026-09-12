import { Module } from '@nestjs/common';
import { CacheModule } from '../../infrastructure/cache/cache.module';
import { SharedModule } from '../shared/shared.module';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionRepository } from './permission.repository';
import { PermissionResolver } from './permission-resolver.service';
import { PermissionsGuard } from './permissions.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

/**
 * Fine-grained authorization, layered on top of the existing role gate.
 *
 * Deliberately separate from `AuthModule`: authentication answers "who is this?"
 * and is already large (Passport, JWT, queues, email); this answers "may they?".
 * It also has to be resolvable from `AppModule` for the global guard, and must
 * not depend on `UsersModule` — `UsersModule` depends on THIS one, to invalidate
 * the permission cache when a role changes.
 *
 * `CacheModule` is imported directly (rather than relied on as `@Global()`) so a
 * module-subset e2e context resolves `REDIS_CLIENT` without importing AppModule.
 */
@Module({
  imports: [CacheModule, SharedModule],
  controllers: [RbacController],
  providers: [
    PermissionRepository,
    PermissionCacheService,
    PermissionResolver,
    PermissionsGuard,
    RbacService,
  ],
  exports: [
    PermissionResolver,
    PermissionsGuard,
    PermissionCacheService,
    PermissionRepository,
  ],
})
export class AuthorizationModule {}
