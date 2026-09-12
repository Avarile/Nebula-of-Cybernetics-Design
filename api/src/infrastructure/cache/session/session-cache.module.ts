import { Module } from '@nestjs/common';
import { CacheModule } from '../cache.module';
import { SessionCacheService } from './session-cache.service';

/**
 * Provides `SessionCacheService`, which needs `REDIS_CLIENT`.
 *
 * `CacheModule` is `@Global()`, but a global module only registers its
 * providers once something pulls it into the graph. AppModule does, so the
 * running app was fine; a module-subset test context (every e2e suite here
 * builds one rather than importing AppModule) does not, and this module then
 * failed to resolve `REDIS_CLIENT`. Since A-2 made `TokenRevocationModule`
 * depend on the session cache, that broke every suite that imports AuthModule.
 * Import CacheModule directly so this module is self-sufficient, the same way
 * SystemModule does.
 */
@Module({
  imports: [CacheModule],
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
