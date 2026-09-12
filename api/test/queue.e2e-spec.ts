import {
  BullModule,
  Processor,
  WorkerHost,
  getQueueToken,
} from '@nestjs/bullmq';
import { INestApplication, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { ConfigModule } from '../src/config/config.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';

/**
 * Test-only queue + worker.
 *
 * These used to live in `src/` as `ExampleProcessor`/`ExampleScheduler`, which
 * meant every production replica ran a worker polling an empty queue forever.
 * The wiring is worth testing; shipping it is not — so the fixture moved here.
 */
const TEST_QUEUE = 'e2e-test-queue';

@Processor(TEST_QUEUE)
class TestProcessor extends WorkerHost {
  private readonly logger = new Logger(TestProcessor.name);
  async process(job: Job): Promise<void> {
    this.logger.log(`Processing job ${job.id ?? '?'} (${job.name})`);
  }
}

@Module({
  imports: [QueueModule, BullModule.registerQueue({ name: TEST_QUEUE })],
  providers: [TestProcessor],
})
class TestQueueModule {}

/**
 * BullMQ integration test.
 *
 * Boots only the ConfigModule + QueueModule (no HTTP/DB/Sentry) and drives the
 * real `QueueModule` wiring — the shared Redis connection, a registered queue,
 * and a locally-declared worker — against the live Redis configured in
 * `.env`. Verifies: connection, enqueue → consume → complete, and delayed jobs.
 *
 * Requires a reachable Redis (see the REDIS_* vars in `.env`). Run with
 * `pnpm test:e2e -- queue.e2e-spec`.
 *
 * NOTE: `@nestjs/bullmq` binds `instance.process` (via `.bind`) when it creates
 * the worker at bootstrap, so the spy must be installed on the prototype BEFORE
 * `app.init()` — a spy applied afterwards would be bypassed by the already-bound
 * reference. See bull.explorer.js.
 */
jest.setTimeout(30_000);

/** Polls `predicate` until it resolves truthy or the timeout elapses. */
async function waitFor(
  predicate: () => Promise<boolean>,
  { timeout = 10_000, interval = 100 } = {},
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

describe('BullMQ queue (e2e)', () => {
  let app: INestApplication;
  let queue: Queue;
  let processSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, TestQueueModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // Must be set before init() — see the note in the file header.
    processSpy = jest.spyOn(TestProcessor.prototype, 'process');

    await app.init(); // starts the TestProcessor worker

    queue = app.get<Queue>(getQueueToken(TEST_QUEUE));
  });

  afterAll(async () => {
    // Remove any jobs this suite left behind, then close all Redis connections.
    await queue?.drain(true).catch(() => undefined);
    await app?.close();
    processSpy?.mockRestore();
  });

  it('connects the default queue to the configured Redis', async () => {
    expect(queue).toBeDefined();
    expect(queue.name).toBe(TEST_QUEUE);

    // waitUntilReady resolves with the live ioredis client once connected.
    // bullmq types it as the narrow IRedisClient, so cast to expose ping().
    const client = (await queue.waitUntilReady()) as unknown as Redis;
    await expect(client.ping()).resolves.toBe('PONG');
  });

  it('enqueues a job and the processor consumes it to completion', async () => {
    processSpy.mockClear();
    const payload = { source: 'e2e', at: Date.now() };

    const job = await queue.add('e2e-test-job', payload, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });

    await waitFor(async () => (await job.getState()) === 'completed');

    // The worker actually invoked TestProcessor.process with our job.
    const call = processSpy.mock.calls.find(
      ([j]) => (j as Job).name === 'e2e-test-job',
    );
    expect(call).toBeDefined();
    expect((call![0] as Job).data).toMatchObject(payload);
    expect(await job.getState()).toBe('completed');

    await job.remove();
  });

  it('honours delayed scheduling and still processes the job', async () => {
    const job = await queue.add(
      'e2e-delayed-job',
      {},
      { delay: 500, attempts: 1, removeOnComplete: false },
    );

    // Right after enqueue it should be pending (delayed/waiting), not yet done.
    expect(['delayed', 'waiting', 'active', 'completed']).toContain(
      await job.getState(),
    );

    await waitFor(async () => (await job.getState()) === 'completed');
    expect(await job.getState()).toBe('completed');

    await job.remove();
  });
});
