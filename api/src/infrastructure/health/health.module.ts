import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { SearchServiceModule } from '../../features/search-service/search-service.module';
import { DatabaseHealthIndicator } from './database.health';
import { HealthController } from './health.controller';
import { MeiliHealthIndicator } from './meili.health';
import { MinioHealthIndicator } from './minio.health';
import { RedisHealthIndicator } from './redis.health';

/**
 * `SearchServiceModule` is imported so the Meili indicator can report index lag
 * alongside Meili liveness. That points infrastructure at a feature, which is
 * the wrong direction on paper — but the alternative is a liveness-only probe
 * that stays green while the read model falls arbitrarily far behind. The
 * indicator injects the service `@Optional()`, so a health module booted
 * without the search feature degrades to the liveness check instead of failing.
 */
@Module({
  imports: [TerminusModule, SearchServiceModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    MinioHealthIndicator,
    MeiliHealthIndicator,
  ],
})
export class HealthModule {}
