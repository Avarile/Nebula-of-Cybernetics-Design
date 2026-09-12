import { SearchPurgeScheduler } from './search-purge.scheduler';

function make(everyMs = 86_400_000) {
  const queue = {
    upsertJobScheduler: jest.fn<Promise<undefined>, [string, unknown, unknown]>(
      async () => undefined,
    ),
  };
  const config = {
    getOrThrow: () => ({ purgeEveryMs: everyMs, purgeAfterDays: 30 }),
  };
  const scheduler = new SearchPurgeScheduler(queue as never, config as never);
  return { scheduler, queue };
}

describe('SearchPurgeScheduler', () => {
  it('registers the purge sweep on application bootstrap', async () => {
    const { scheduler, queue } = make(3_600_000);

    await scheduler.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'search-purge',
      { every: 3_600_000 },
      expect.objectContaining({ name: 'purge-records' }),
    );
  });

  it('does not block boot when Redis is unavailable', async () => {
    const { scheduler, queue } = make();
    queue.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'));
    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
