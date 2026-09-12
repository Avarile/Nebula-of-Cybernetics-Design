import { SearchReconciliationScheduler } from './search-reconciliation.scheduler';

function make(everyMs = 60_000) {
  const queue = {
    upsertJobScheduler: jest.fn<Promise<undefined>, [string, unknown, unknown]>(
      async () => undefined,
    ),
  };
  const config = { getOrThrow: () => ({ reconcileEveryMs: everyMs }) };
  const scheduler = new SearchReconciliationScheduler(
    queue as never,
    config as never,
  );
  return { scheduler, queue };
}

describe('SearchReconciliationScheduler', () => {
  it('registers the sweep on application bootstrap', async () => {
    const { scheduler, queue } = make(30_000);

    await scheduler.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'search-reconcile',
      { every: 30_000 },
      expect.objectContaining({ name: 'reconcile' }),
    );
  });

  it('uses upsert so re-registering on every boot cannot orphan repeatables', async () => {
    const { scheduler, queue } = make();
    await scheduler.onApplicationBootstrap();
    await scheduler.onApplicationBootstrap();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    const [firstId] = queue.upsertJobScheduler.mock.calls[0];
    const [secondId] = queue.upsertJobScheduler.mock.calls[1];
    expect(firstId).toBe(secondId);
  });

  it('does not block boot when Redis is unavailable', async () => {
    const { scheduler, queue } = make();
    queue.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'));
    await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
