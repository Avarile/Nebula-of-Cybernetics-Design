import { createKeyv } from '@keyv/redis';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisConfig } from '../../config/configurations/redis.config';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import {
  REDIS_CLIENT,
  RedisClientLifecycle,
  redisClientProvider,
} from './redis.provider';

/**
 * Global cache infrastructure:
 *  - `CACHE_MANAGER` (from `@nestjs/cache-manager`) backed by a Redis/Keyv store
 *    for general-purpose caching.
 *  - `REDIS_CLIENT`, a shared raw ioredis client for lower-level needs
 *    (session cache, health checks).
 */
@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.getOrThrow<RedisConfig>('redis');
        const auth = redis.password
          ? `:${encodeURIComponent(redis.password)}@`
          : '';
        const url = `redis://${auth}${redis.host}:${redis.port}/${redis.db}`;
        return { stores: [createKeyv(url)] };
      },
    }),
  ],
  providers: [redisClientProvider, RedisClientLifecycle, RedisThrottlerStorage],
  exports: [REDIS_CLIENT, RedisThrottlerStorage, NestCacheModule],
})
export class CacheModule {}
