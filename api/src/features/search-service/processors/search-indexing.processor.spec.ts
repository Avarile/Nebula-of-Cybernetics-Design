import type { Job } from 'bullmq';
import type { SearchRecordRow } from '../../../infrastructure/database/schema/search.schema';
import { SearchMetrics } from '../search.metrics';
import { SearchIndexingProcessor } from './search-indexing.processor';

function liveRow(over: Partial<SearchRecordRow> = {}): SearchRecordRow {
  return {
    id: 'rec-1',
    collection: 'articles',
    externalId: 'ext-1',
    document: { title: 'Hi' },
    checksum: 'c',
    indexState: 'PENDING',
    indexError: null,
    indexedAt: null,
    indexAttemptedAt: new Date('2026-01-01T00:00:00Z'),
    indexAttempts: 0,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as SearchRecordRow;
}

const CONFIG = {
  reconcileStaleMs: 300_000,
  reconcileMaxBackoffMs: 3_600_000,
  reconcileBatch: 500,
  indexBatchSize: 500,
  indexConcurrency: 4,
  maxIndexAttempts: 10,
  purgeAfterDays: 30,
  purgeBatch: 1000,
};

function make(
  repoOverrides: Record<string, any> = {},
  engineOverrides: Record<string, any> = {},
  cfgOverrides: Partial<typeof CONFIG> = {},
) {
  const engine = {
    ensureIndex: jest.fn(async () => undefined),
    needsEnsure: jest.fn<Promise<boolean>, [unknown]>(async () => false),
    addOrReplace: jest.fn(async () => ({ taskUid: 1 })),
    deleteDocuments: jest.fn(async () => ({ taskUid: 2 })),
    clearIndex: jest.fn(async () => ({ taskUid: 3 })),
    deleteIndex: jest.fn(async () => ({ taskUid: 4 })),
    waitForTask: jest.fn(async () => undefined),
    ...engineOverrides,
  };
  const records = {
    findById: jest.fn(async () => liveRow()),
    findByIds: jest.fn<Promise<SearchRecordRow[]>, [string[]]>(async () => [
      liveRow(),
    ]),
    markIndexState: jest.fn(async () => undefined),
    markIndexStateMany: jest.fn<
      Promise<undefined>,
      [string[], string, { indexedAt?: Date; indexError?: string | null }?]
    >(async () => undefined),
    markCollectionPurged: jest.fn(async () => undefined),
    pageLiveByCollection: jest.fn(async () => [] as SearchRecordRow[]),
    findUnsynced: jest.fn<
      Promise<SearchRecordRow[]>,
      [number, { staleMs: number; maxBackoffMs: number }]
    >(async () => []),
    findConvergedAfter: jest.fn<
      Promise<SearchRecordRow[]>,
      [string, Date, number]
    >(async () => []),
    purgeSoftDeleted: jest.fn<Promise<number>, [Date, number]>(async () => 0),
    ...repoOverrides,
  };
  const registry = {
    resolve: jest.fn(async (name: string) => ({
      name,
      definition: { name, primaryKey: 'id' },
    })),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const config = { getOrThrow: () => ({ ...CONFIG, ...cfgOverrides }) };
  const metrics = new SearchMetrics();
  const processor = new SearchIndexingProcessor(
    engine as never,
    records as never,
    registry as never,
    queue as never,
    config as never,
    metrics,
  );
  return { processor, engine, records, registry, queue, metrics };
}

function indexJob(collection: string, ids: string[]): Job {
  return { name: 'index-records', data: { collection, ids } } as Job;
}

describe('SearchIndexingProcessor: index-records', () => {
  it('adds live rows to Meili and marks the batch INDEXED', async () => {
    const { processor, engine, records } = make();
    await processor.process(indexJob('articles', ['rec-1']));
    expect(engine.addOrReplace).toHaveBeenCalledWith(
      'articles',
      [expect.objectContaining({ id: 'rec-1', title: 'Hi' })],
      { primaryKey: 'id' },
    );
    expect(engine.waitForTask).toHaveBeenCalledWith(1);
    expect(records.markIndexStateMany).toHaveBeenCalledWith(
      ['rec-1'],
      'INDEXED',
      expect.objectContaining({ indexError: null }),
    );
  });

  it('splits a mixed batch into one add and one delete', async () => {
    const rows = [
      liveRow({ id: 'a' }),
      liveRow({ id: 'b', isDeleted: true }),
      liveRow({ id: 'c' }),
    ];
    const { processor, engine, records } = make({
      findByIds: jest.fn(async () => rows),
    });
    await processor.process(indexJob('articles', ['a', 'b', 'c']));
    expect(engine.addOrReplace).toHaveBeenCalledTimes(1);
    expect(engine.addOrReplace).toHaveBeenCalledWith(
      'articles',
      [
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ id: 'c' }),
      ],
      { primaryKey: 'id' },
    );
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['b']);
    expect(records.markIndexStateMany).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      'INDEXED',
      expect.anything(),
    );
  });

  it('deletes from Meili when every row in the batch is soft-deleted', async () => {
    const { processor, engine } = make({
      findByIds: jest.fn(async () => [liveRow({ isDeleted: true })]),
    });
    await processor.process(indexJob('articles', ['rec-1']));
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['rec-1']);
    expect(engine.addOrReplace).not.toHaveBeenCalled();
  });

  it('no-ops when the rows are gone', async () => {
    const { processor, engine } = make({ findByIds: jest.fn(async () => []) });
    await processor.process(indexJob('articles', ['rec-1']));
    expect(engine.addOrReplace).not.toHaveBeenCalled();
  });

  it('marks the batch FAILED and rethrows so BullMQ retries', async () => {
    const { processor, records, metrics } = make(
      {
        findByIds: jest.fn(async () => [
          liveRow({ id: 'a' }),
          liveRow({ id: 'b' }),
        ]),
      },
      {
        addOrReplace: jest.fn(async () => {
          throw new Error('meili down');
        }),
      },
    );
    await expect(
      processor.process(indexJob('articles', ['a', 'b'])),
    ).rejects.toThrow('meili down');
    expect(records.markIndexStateMany).toHaveBeenCalledWith(
      ['a', 'b'],
      'FAILED',
      expect.objectContaining({ indexError: 'meili down' }),
    );
    expect(metrics.snapshot().indexFailure).toBe(2);
  });

  it('rejects a malformed job payload', async () => {
    const { processor } = make();
    await expect(
      processor.process({
        name: 'index-records',
        data: { collection: 'articles' },
      } as Job),
    ).rejects.toThrow('"ids" must be a non-empty array of strings');
  });

  it('still consumes legacy single-record jobs during a rolling deploy', async () => {
    const { processor, engine } = make();
    await processor.process({
      name: 'index-record',
      data: { id: 'rec-1' },
    } as Job);
    expect(engine.addOrReplace).toHaveBeenCalledWith(
      'articles',
      [expect.objectContaining({ id: 'rec-1' })],
      { primaryKey: 'id' },
    );
  });

  it('still consumes legacy delete-record jobs during a rolling deploy', async () => {
    const { processor, engine } = make({
      findById: jest.fn(async () => liveRow({ isDeleted: true })),
      findByIds: jest.fn(async () => [liveRow({ isDeleted: true })]),
    });
    await processor.process({
      name: 'delete-record',
      data: { collection: 'articles', id: 'rec-1' },
    } as Job);
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['rec-1']);
  });
});

describe('SearchIndexingProcessor: index existence', () => {
  it('applies collection settings before writing, so a wiped index is repaired', async () => {
    const { processor, engine } = make();
    await processor.process(indexJob('articles', ['rec-1']));
    expect(engine.ensureIndex).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'articles' }),
    );
  });

  it('applies settings once but verifies existence on every batch', async () => {
    const { processor, engine } = make();
    await processor.process(indexJob('articles', ['rec-1']));
    await processor.process(indexJob('articles', ['rec-1']));
    // Settings are the expensive part, so they stay memoised...
    expect(engine.ensureIndex).toHaveBeenCalledTimes(1);
    // ...but every batch after the first rechecks the configuration, because an
    // index can lose it after being ensured. The first batch skips the check:
    // it is about to apply settings unconditionally anyway.
    expect(engine.needsEnsure).toHaveBeenCalledTimes(1);
    expect(engine.addOrReplace).toHaveBeenCalledTimes(2);
  });

  // Regression: a memo-only guard let a mid-process index wipe through, and the
  // recreated index served every filter as "not filterable".
  it('reapplies settings when the index lost its configuration', async () => {
    const { processor, engine, metrics } = make();
    await processor.process(indexJob('articles', ['rec-1']));
    engine.needsEnsure.mockResolvedValueOnce(true);
    await processor.process(indexJob('articles', ['rec-1']));
    expect(engine.ensureIndex).toHaveBeenCalledTimes(2);
    expect(metrics.snapshot().indexRecreated).toBe(1);
  });

  it('does not count the first ensure as a recreation', async () => {
    const { processor, metrics } = make();
    await processor.process(indexJob('articles', ['rec-1']));
    expect(metrics.snapshot().indexRecreated).toBe(0);
  });

  it('skips settings for a collection deleted mid-flight', async () => {
    const { processor, engine, registry } = make();
    registry.resolve.mockResolvedValueOnce(null as never);
    await processor.process(indexJob('articles', ['rec-1']));
    expect(engine.ensureIndex).not.toHaveBeenCalled();
    expect(engine.addOrReplace).toHaveBeenCalled();
  });
});

describe('SearchIndexingProcessor: reindex-collection', () => {
  it('re-applies settings, clears, then reloads live rows in pages', async () => {
    const page1 = [liveRow({ id: 'a' }), liveRow({ id: 'b' })];
    const pager = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([]);
    const { processor, engine, records } = make({
      pageLiveByCollection: pager,
    });
    await processor.process({
      name: 'reindex-collection',
      data: { collection: 'articles' },
    } as Job);
    expect(engine.ensureIndex).toHaveBeenCalled();
    expect(engine.clearIndex).toHaveBeenCalledWith('articles');
    expect(engine.addOrReplace).toHaveBeenCalledWith(
      'articles',
      [
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ id: 'b' }),
      ],
      { primaryKey: 'id' },
    );
    // Only the ids this pass actually wrote are stamped.
    expect(records.markIndexStateMany).toHaveBeenCalledWith(
      ['a', 'b'],
      'INDEXED',
      expect.objectContaining({ indexError: null }),
    );
  });

  it('stamps the pass with one timestamp, so racing writers stay identifiable', async () => {
    const pager = jest
      .fn()
      .mockResolvedValueOnce([liveRow({ id: 'a' })])
      .mockResolvedValueOnce([]);
    const { processor, records } = make({ pageLiveByCollection: pager });
    await processor.process({
      name: 'reindex-collection',
      data: { collection: 'articles' },
    } as Job);
    const stampedAt = records.markIndexStateMany.mock.calls[0][2]?.indexedAt;
    const [, since] = records.findConvergedAfter.mock.calls[0];
    expect(since).toEqual(stampedAt);
  });

  // A record written during the rebuild can be indexed by its own job and then
  // wiped by the reload's clear, while its row still claims INDEXED. Nothing
  // else would notice, so the reload has to hand those back to the indexer.
  it('re-drives records that converged during the rebuild', async () => {
    const pager = jest
      .fn()
      .mockResolvedValueOnce([liveRow({ id: 'a' })])
      .mockResolvedValueOnce([]);
    const { processor, queue } = make({
      pageLiveByCollection: pager,
      findConvergedAfter: jest.fn(async () => [liveRow({ id: 'racer' })]),
    });
    await processor.process({
      name: 'reindex-collection',
      data: { collection: 'articles' },
    } as Job);
    expect(queue.add).toHaveBeenCalledWith(
      'index-records',
      { collection: 'articles', ids: ['racer'] },
      expect.anything(),
    );
  });

  it('enqueues nothing when no writer raced the rebuild', async () => {
    const { processor, queue } = make();
    await processor.process({
      name: 'reindex-collection',
      data: { collection: 'articles' },
    } as Job);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('SearchIndexingProcessor: reconcile', () => {
  it('re-enqueues unsynced records as batched jobs grouped by collection', async () => {
    const rows = [
      liveRow({ id: 'live-1' }),
      liveRow({ id: 'del-1', isDeleted: true }),
      liveRow({ id: 'other-1', collection: 'notes' }),
    ];
    const { processor, queue, metrics } = make({
      findUnsynced: jest.fn(async () => rows),
    });
    await processor.process({ name: 'reconcile', data: {} } as Job);
    expect(queue.add).toHaveBeenCalledWith(
      'index-records',
      { collection: 'articles', ids: ['live-1', 'del-1'] },
      expect.anything(),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'index-records',
      { collection: 'notes', ids: ['other-1'] },
      expect.anything(),
    );
    expect(metrics.snapshot().reconcileRequeued).toBe(3);
  });

  it('splits a large backlog across jobs of at most indexBatchSize', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => liveRow({ id: `r${i}` }));
    const { processor, queue } = make(
      { findUnsynced: jest.fn(async () => rows) },
      {},
      { indexBatchSize: 2 },
    );
    await processor.process({ name: 'reconcile', data: {} } as Job);
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  it('does nothing when everything has converged', async () => {
    const { processor, queue } = make({
      findUnsynced: jest.fn(async () => []),
    });
    await processor.process({ name: 'reconcile', data: {} } as Job);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('passes the configured batch size and backoff bounds', async () => {
    const { processor, records } = make(
      {},
      {},
      { reconcileStaleMs: 1000, reconcileMaxBackoffMs: 60_000 },
    );
    await processor.process({ name: 'reconcile', data: {} } as Job);
    expect(records.findUnsynced).toHaveBeenCalledWith(500, {
      staleMs: 1000,
      maxBackoffMs: 60_000,
    });
  });
});

describe('SearchIndexingProcessor: purge and drop-index', () => {
  it('purges soft-deleted rows past the retention window', async () => {
    const { processor, records, metrics } = make({
      purgeSoftDeleted: jest.fn(async () => 7),
    });
    await processor.process({ name: 'purge-records', data: {} } as Job);
    const [cutoff, limit] = records.purgeSoftDeleted.mock.calls[0];
    expect(limit).toBe(1000);
    expect((cutoff as Date).getTime()).toBeLessThan(Date.now());
    expect(metrics.snapshot().purged).toBe(7);
  });

  it('marks records converged only after the index drop succeeds', async () => {
    const { processor, engine, records } = make();
    await processor.process({
      name: 'drop-index',
      data: { collection: 'articles' },
    } as Job);
    expect(engine.deleteIndex).toHaveBeenCalledWith('articles');
    expect(records.markCollectionPurged).toHaveBeenCalledWith('articles');
  });

  it('rethrows a failed index drop so the job retries', async () => {
    const { processor, records } = make(
      {},
      {
        deleteIndex: jest.fn(async () => {
          throw new Error('meili down');
        }),
      },
    );
    await expect(
      processor.process({
        name: 'drop-index',
        data: { collection: 'articles' },
      } as Job),
    ).rejects.toThrow('meili down');
    expect(records.markCollectionPurged).not.toHaveBeenCalled();
  });
});
