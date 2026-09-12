import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisConfig } from '../../config/configurations/redis.config';

/**
 * Shared job options applied to every queue.
 *
 * Previously each producer passed its own set, which worked only for as long as
 * nobody forgot: a job added without `removeOnComplete`/`removeOnFail` stays in
 * Redis forever, and the omission is invisible until the instance runs out of
 * memory. Setting them here makes the safe behaviour the default and lets a
 * producer override deliberately rather than by accident.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: true,
  /** Keep a bounded tail of failures for diagnosis rather than all of them. */
  removeOnFail: 100,
};

/**
 * BullMQ infrastructure. `forRootAsync` sets the shared Redis connection and the
 * default job options; each feature module registers the queues it owns.
 *
 * This module deliberately registers no queue of its own. It used to declare a
 * `default` queue with an example processor that logged and did nothing, so
 * every replica ran a worker polling an empty queue for the lifetime of the
 * process. The BullMQ wiring is still covered end-to-end by
 * `test/queue.e2e-spec.ts`, which registers its own queue and processor.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.getOrThrow<RedisConfig>('redis');
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            db: redis.db,
          },
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
