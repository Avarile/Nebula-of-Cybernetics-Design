import { SearchMetrics } from './search.metrics';
import { SearchStatusService } from './search-status.service';
import type { SyncStats } from './search.types';

function stats(over: Partial<SyncStats> = {}): SyncStats {
  return {
    pending: 0,
    indexed: 10,
    failed: 0,
    oldestUnsyncedAt: null,
    maxAttempts: 0,
    ...over,
  };
}

function make(over: Partial<SyncStats> = {}, lagAlertSeconds = 300) {
  const records = {
    syncStats: jest.fn<Promise<SyncStats>, [string?]>(async () => stats(over)),
    findUnsyncedByCollection: jest.fn<
      Promise<Record<string, unknown>[]>,
      [string, number]
    >(async () => []),
  };
  const metrics = new SearchMetrics();
  const config = {
    getOrThrow: () => ({ lagAlertSeconds, maxIndexAttempts: 10 }),
  };
  const service = new SearchStatusService(
    records as never,
    metrics,
    config as never,
  );
  return { service, records, metrics };
}

describe('SearchStatusService', () => {
  it('reports zero lag when everything has converged', () => {
    const { service } = make();
    expect(service.lagSeconds(stats())).toBe(0);
    expect(service.isDegraded(stats())).toBe(false);
  });

  it('measures lag from the oldest unconverged attempt', () => {
    const { service } = make();
    const oldestUnsyncedAt = new Date(Date.now() - 90_000);
    expect(
      service.lagSeconds(stats({ oldestUnsyncedAt })),
    ).toBeGreaterThanOrEqual(89);
  });

  it('flags degraded once lag passes the configured threshold', () => {
    const { service } = make({}, 60);
    const lagging = stats({ oldestUnsyncedAt: new Date(Date.now() - 120_000) });
    expect(service.isDegraded(lagging)).toBe(true);
  });

  it('does not flag degraded exactly at the threshold', () => {
    const { service } = make({}, 120);
    const atThreshold = stats({
      oldestUnsyncedAt: new Date(Date.now() - 120_000),
    });
    expect(service.isDegraded(atThreshold)).toBe(false);
  });

  it('surfaces failing records for a single collection', async () => {
    const { service, records } = make({ failed: 2, maxAttempts: 4 });
    records.findUnsyncedByCollection.mockResolvedValueOnce([
      {
        id: 'rec-1',
        externalId: 'ext-1',
        indexState: 'FAILED',
        indexAttempts: 4,
        indexError: 'meili down',
        indexAttemptedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ] as never);
    const view = await service.status('articles');
    expect(view.collection).toBe('articles');
    expect(view.counts.failed).toBe(2);
    expect(view.maxAttempts).toBe(4);
    expect(view.stuckThreshold).toBe(10);
    expect(view.worstOffenders[0]).toMatchObject({
      id: 'rec-1',
      indexError: 'meili down',
      indexAttempts: 4,
    });
  });

  it('omits per-record detail for the all-collections view', async () => {
    const { service, records } = make();
    const view = await service.status();
    expect(view.collection).toBeNull();
    expect(view.worstOffenders).toEqual([]);
    expect(records.findUnsyncedByCollection).not.toHaveBeenCalled();
  });

  it('includes the process counters alongside the durable counts', async () => {
    const { service, metrics } = make();
    metrics.increment('indexSuccess', 3);
    metrics.increment('enqueueFailure');
    const view = await service.status();
    expect(view.counters).toMatchObject({
      indexSuccess: 3,
      enqueueFailure: 1,
    });
  });
});

describe('SearchStatusService.cachedStats', () => {
  // `syncStats` is four filtered aggregates plus min/max over the largest table
  // in the schema, and the readiness probe called it on every request.
  it('does not re-query within the cache window', async () => {
    const { service, records } = make();
    await service.cachedStats();
    await service.cachedStats();
    await service.cachedStats();
    expect(records.syncStats).toHaveBeenCalledTimes(1);
  });

  it('returns the same snapshot while cached', async () => {
    const { service } = make();
    expect(await service.cachedStats()).toEqual(await service.cachedStats());
  });

  it('re-queries once the window lapses', async () => {
    jest.useFakeTimers();
    try {
      const { service, records } = make();
      await service.cachedStats();
      jest.advanceTimersByTime(20_000);
      await service.cachedStats();
      expect(records.syncStats).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the uncached accessor alone for the admin status view', async () => {
    const { service, records } = make();
    await service.cachedStats();
    await service.stats();
    // The admin endpoint must show current numbers, not a cached snapshot.
    expect(records.syncStats).toHaveBeenCalledTimes(2);
  });
});
