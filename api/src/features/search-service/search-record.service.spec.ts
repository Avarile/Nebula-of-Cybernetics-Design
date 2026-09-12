import type { ConfigService } from '@nestjs/config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SearchEngineError } from '../../infrastructure/search-engine/search-engine.interface';
import type { Principal } from '../../common/principal';
import type { CompiledCollection } from './index-registry';
import { SearchMetrics } from './search.metrics';
import { SearchRecordService } from './search-record.service';

const compiled: CompiledCollection = {
  name: 'articles',
  displayName: 'Articles',
  description: null,
  fields: [
    { name: 'title', type: 'string', required: true, searchable: true },
    { name: 'status', type: 'string', filterable: true },
  ],
  definition: {
    name: 'articles',
    primaryKey: 'id',
    searchableAttributes: ['title'],
    filterableAttributes: ['status', 'createdAt', 'updatedAt', 'externalId'],
    sortableAttributes: ['createdAt', 'updatedAt'],
  },
  // The existing suite is about filters/paging/plumbing, not policy — declare
  // it shared so those assertions keep testing what they were written to test.
  // Policy itself has its own exhaustive truth table in read-scope.spec.ts.
  visibility: 'shared',
  ownerField: null,
};

const READER: Principal = { kind: 'user', userId: 'u-1', role: 'user' };

const CONFIG = {
  defaultPageSize: 20,
  maxPageSize: 100,
  indexBatchSize: 500,
  waitTimeoutMs: 300,
};

function make(
  repoOverrides: Record<string, any> = {},
  engineOverrides: Record<string, any> = {},
  cfgOverrides: Partial<typeof CONFIG> = {},
) {
  const config = {
    getOrThrow: () => ({ ...CONFIG, ...cfgOverrides }),
  } as unknown as ConfigService;
  const engine = {
    search: jest.fn(async () => ({
      hits: [{ id: '1' }],
      totalHits: 1,
      page: 1,
      hitsPerPage: 20,
      totalPages: 1,
      processingTimeMs: 2,
    })),
    ...engineOverrides,
  };
  const records = {
    findLiveByExternalId: jest.fn(async () => null),
    findLiveByExternalIds: jest.fn(async () => []),
    findLiveById: jest.fn(async () => null),
    findByIds: jest.fn<Promise<Array<Record<string, unknown>>>, [string[]]>(
      async () => [],
    ),
    // Echo the planned rows back, as the real upsert's RETURNING does.
    upsertMany: jest.fn(async (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => ({ ...r })),
    ),
    softDelete: jest.fn(async () => undefined),
    ...repoOverrides,
  };
  const queue = { add: jest.fn(async () => undefined) };
  const registry = {
    resolve: jest.fn(async (name: string) =>
      name === 'articles' ? compiled : null,
    ),
  };
  const metrics = new SearchMetrics();
  const service = new SearchRecordService(
    engine as never,
    records as never,
    registry as never,
    queue as never,
    config,
    new ExceptionService(),
    metrics,
  );
  return { service, engine, records, queue, registry, metrics };
}

function searchArg(engine: any) {
  return engine.search.mock.calls[0]?.[1];
}

describe('SearchRecordService.persist', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(
      service.persist('nope', [{ document: { title: 'x' } }]),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
  });

  it('400s when a document fails validation', async () => {
    const { service } = make();
    await expect(
      service.persist('articles', [{ document: { title: 123 } }]),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Record 0 failed validation',
      details: {
        issues: [
          {
            path: 'records[0]',
            message: 'Field "title" must be of type string',
          },
        ],
      },
    });
  });

  it('rejects the whole batch before writing anything when one record is bad', async () => {
    const { service, records } = make();
    await expect(
      service.persist('articles', [
        { document: { title: 'ok' } },
        { document: { title: 123 } },
      ]),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(records.upsertMany).not.toHaveBeenCalled();
  });

  it('writes a PENDING row and hands the id to the indexer', async () => {
    const { service, records, queue } = make();
    const results = await service.persist('articles', [
      { document: { title: 'Hello' } },
    ]);
    expect(records.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        collection: 'articles',
        indexState: 'PENDING',
        indexAttempts: 0,
      }),
    ]);
    expect(queue.add).toHaveBeenCalledWith(
      'index-records',
      { collection: 'articles', ids: [results[0].id] },
      expect.anything(),
    );
    expect(results[0].indexState).toBe('PENDING');
  });

  it('writes the whole batch in one upsert', async () => {
    const { service, records, queue } = make();
    await service.persist('articles', [
      { externalId: 'a', document: { title: 'A' } },
      { externalId: 'b', document: { title: 'B' } },
    ]);
    expect(records.upsertMany).toHaveBeenCalledTimes(1);
    expect(records.upsertMany.mock.calls[0][0]).toHaveLength(2);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('collapses a duplicated externalId so the upsert cannot touch a row twice', async () => {
    const { service, records } = make();
    await service.persist('articles', [
      { externalId: 'dup', document: { title: 'first' } },
      { externalId: 'dup', document: { title: 'last' } },
    ]);
    const rows = records.upsertMany.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].document).toEqual({ title: 'last' });
  });

  it('splits the handoff into jobs of at most indexBatchSize', async () => {
    const { service, queue } = make({}, {}, { indexBatchSize: 2 });
    await service.persist(
      'articles',
      Array.from({ length: 5 }, (_, i) => ({
        externalId: `e${i}`,
        document: { title: `T${i}` },
      })),
    );
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  it('is a no-op when an unchanged, already-indexed record is re-sent', async () => {
    const { computeChecksum } = await import('./search.util');
    const checksum = computeChecksum('ext-1', { title: 'Hello' });
    const { service, queue, records } = make({
      findLiveByExternalIds: jest.fn(async () => [
        {
          id: 'rec-1',
          externalId: 'ext-1',
          indexState: 'INDEXED',
          checksum,
        },
      ]),
    });
    const results = await service.persist('articles', [
      { externalId: 'ext-1', document: { title: 'Hello' } },
    ]);
    expect(results[0]).toMatchObject({ id: 'rec-1', indexState: 'INDEXED' });
    expect(records.upsertMany).toHaveBeenCalledWith([]);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('re-indexes an unchanged record that never converged', async () => {
    const { computeChecksum } = await import('./search.util');
    const checksum = computeChecksum('ext-1', { title: 'Hello' });
    const { service, queue } = make({
      findLiveByExternalIds: jest.fn(async () => [
        { id: 'rec-1', externalId: 'ext-1', indexState: 'FAILED', checksum },
      ]),
    });
    await service.persist('articles', [
      { externalId: 'ext-1', document: { title: 'Hello' } },
    ]);
    expect(queue.add).toHaveBeenCalled();
  });

  it('reuses the existing id when upserting over a known business key', async () => {
    const { service, records } = make({
      findLiveByExternalIds: jest.fn(async () => [
        {
          id: 'rec-existing',
          externalId: 'ext-1',
          indexState: 'INDEXED',
          checksum: 'stale',
        },
      ]),
    });
    const results = await service.persist('articles', [
      { externalId: 'ext-1', document: { title: 'Changed' } },
    ]);
    expect(records.upsertMany.mock.calls[0][0][0].id).toBe('rec-existing');
    expect(results[0].id).toBe('rec-existing');
  });

  it('keeps results parallel to the input across a mix of skips and writes', async () => {
    const { computeChecksum } = await import('./search.util');
    const { service } = make({
      findLiveByExternalIds: jest.fn(async () => [
        {
          id: 'rec-skip',
          externalId: 'skip-me',
          indexState: 'INDEXED',
          checksum: computeChecksum('skip-me', { title: 'same' }),
        },
      ]),
    });
    const results = await service.persist('articles', [
      { externalId: 'skip-me', document: { title: 'same' } },
      { externalId: 'write-me', document: { title: 'new' } },
    ]);
    expect(results.map((r) => r.externalId)).toEqual(['skip-me', 'write-me']);
    expect(results[0].indexState).toBe('INDEXED');
    expect(results[1].indexState).toBe('PENDING');
  });

  // The durability guarantee: the row is committed, so a failed handoff must not
  // be reported to the caller as a failed write. The sweep owns recovery.
  it('does not fail the write when the index handoff cannot be enqueued', async () => {
    const { service, queue, metrics } = make();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    const results = await service.persist('articles', [
      { document: { title: 'Hello' } },
    ]);
    expect(results[0].indexState).toBe('PENDING');
    expect(metrics.snapshot().enqueueFailure).toBe(1);
  });

  it('returns the settled state when the caller opts into waiting', async () => {
    const { service, records } = make();
    let polls = 0;
    records.findByIds.mockImplementation(async (ids: string[]) => {
      polls += 1;
      return ids.map((id) => ({
        id,
        indexState: polls > 1 ? 'INDEXED' : 'PENDING',
      }));
    });
    const results = await service.persist(
      'articles',
      [{ document: { title: 'Hello' } }],
      true,
    );
    expect(results[0].indexState).toBe('INDEXED');
  });

  it('falls back to PENDING when waiting times out', async () => {
    const { service, records } = make();
    records.findByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, indexState: 'PENDING' })),
    );
    const results = await service.persist(
      'articles',
      [{ document: { title: 'Hello' } }],
      true,
    );
    expect(results[0].indexState).toBe('PENDING');
  });
});

describe('SearchRecordService.search', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(
      service.search('nope', { q: '', page: 1 }, READER),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
  });

  it('builds an allowlisted filter clause', async () => {
    const { service, engine } = make();
    await service.search(
      'articles',
      {
        q: '',
        page: 1,
        filters: { status: 'live' },
      },
      READER,
    );
    expect(searchArg(engine).filter).toEqual(['status = "live"']);
  });

  it('rejects a non-allowlisted filter field', async () => {
    const { service } = make();
    await expect(
      service.search(
        'articles',
        { q: '', page: 1, filters: { secret: 'x' } },
        READER,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_QUERY_INVALID,
      message: 'Unknown filter field "secret"',
    });
  });

  it('caps limit at maxPageSize', async () => {
    const { service, engine } = make();
    await service.search('articles', { q: '', page: 1, limit: 9999 }, READER);
    expect(searchArg(engine).hitsPerPage).toBe(100);
  });

  it('maps an engine failure to 503', async () => {
    const { service } = make(
      {},
      {
        search: jest.fn(async () => {
          throw new SearchEngineError('down');
        }),
      },
    );
    await expect(
      service.search('articles', { q: '', page: 1 }, READER),
    ).rejects.toMatchObject({
      code: ErrorCode.SEARCH_UNAVAILABLE,
      status: 503,
    });
  });
});

describe('SearchRecordService.remove / reload', () => {
  it('reload 404s on unknown collection then enqueues on a known one', async () => {
    const { service, queue } = make();
    await expect(service.reload('nope')).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
    await service.reload('articles');
    expect(queue.add).toHaveBeenCalledWith(
      'reindex-collection',
      { collection: 'articles' },
      expect.anything(),
    );
  });

  it('soft-deletes the row and lets the indexer derive the removal', async () => {
    const { service, records, queue } = make({
      findLiveByExternalId: jest.fn(async () => ({
        id: 'rec-9',
        collection: 'articles',
        externalId: 'ext-9',
      })),
    });
    await service.remove('articles', 'ext-9');
    expect(records.softDelete).toHaveBeenCalledWith('rec-9');
    expect(queue.add).toHaveBeenCalledWith(
      'index-records',
      { collection: 'articles', ids: ['rec-9'] },
      expect.anything(),
    );
  });

  it('does not fail a delete when the handoff cannot be enqueued', async () => {
    const { service, queue, records } = make({
      findLiveByExternalId: jest.fn(async () => ({
        id: 'rec-9',
        collection: 'articles',
        externalId: 'ext-9',
      })),
    });
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.remove('articles', 'ext-9')).resolves.toBeUndefined();
    expect(records.softDelete).toHaveBeenCalledWith('rec-9');
  });
});

describe('SearchRecordService.get', () => {
  const base = {
    document: {},
    indexState: 'INDEXED' as const,
    indexError: null,
    indexAttempts: 0,
    indexedAt: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-02'),
  };

  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(service.get('nope', 'rec-1', READER)).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
    });
  });

  it('resolves a UUID key via findLiveById', async () => {
    const uuid = '11111111-1111-1111-1111-111111111111';
    const { service, records } = make({
      findLiveById: jest.fn(async () => ({
        ...base,
        id: uuid,
        collection: 'articles',
        externalId: 'ext-1',
        document: { title: 'Hi' },
      })),
    });
    const view = await service.get('articles', uuid, READER);
    expect(records.findLiveById).toHaveBeenCalledWith(uuid);
    expect(view).toMatchObject({
      id: uuid,
      externalId: 'ext-1',
      document: { title: 'Hi' },
      indexState: 'INDEXED',
    });
  });

  it('resolves a non-UUID key via findLiveByExternalId', async () => {
    const { service, records } = make({
      findLiveByExternalId: jest.fn(async () => ({
        ...base,
        id: 'rec-9',
        collection: 'articles',
        externalId: 'ext-9',
        indexState: 'PENDING',
      })),
    });
    const view = await service.get('articles', 'ext-9', READER);
    expect(records.findLiveByExternalId).toHaveBeenCalledWith(
      'articles',
      'ext-9',
    );
    expect(view.indexState).toBe('PENDING');
  });

  it('exposes the sync bookkeeping so clients can observe convergence', async () => {
    const { service } = make({
      findLiveByExternalId: jest.fn(async () => ({
        ...base,
        id: 'rec-9',
        collection: 'articles',
        externalId: 'ext-9',
        indexState: 'FAILED',
        indexError: 'meili down',
        indexAttempts: 3,
      })),
    });
    const view = await service.get('articles', 'ext-9', READER);
    expect(view).toMatchObject({
      indexState: 'FAILED',
      indexError: 'meili down',
      indexAttempts: 3,
    });
  });

  it('404s when the row belongs to another collection', async () => {
    const { service } = make({
      findLiveByExternalId: jest.fn(async () => ({
        ...base,
        id: 'r',
        collection: 'other',
        externalId: 'e',
      })),
    });
    await expect(service.get('articles', 'e', READER)).rejects.toMatchObject({
      code: ErrorCode.SEARCH_RECORD_NOT_FOUND,
    });
  });
});

describe('SearchRecordService read policy', () => {
  const ADMIN: Principal = { kind: 'user', userId: 'a-1', role: 'admin' };
  const OTHER: Principal = { kind: 'user', userId: 'u-2', role: 'user' };

  const ownerScoped: CompiledCollection = {
    ...compiled,
    name: 'documents',
    fields: [
      { name: 'title', type: 'string', searchable: true },
      { name: 'ownerUserId', type: 'string', filterable: true },
    ],
    definition: {
      ...compiled.definition,
      name: 'documents',
      filterableAttributes: [
        'ownerUserId',
        'createdAt',
        'updatedAt',
        'externalId',
      ],
    },
    visibility: 'owner_scoped',
    ownerField: 'ownerUserId',
  };

  const privateCollection: CompiledCollection = {
    ...compiled,
    name: 'inbound_email',
    visibility: 'private',
    ownerField: null,
  };

  const withCollection = (def: CompiledCollection, overrides = {}) => {
    const ctx = make(overrides);
    (ctx.registry.resolve as jest.Mock).mockImplementation(async (n: string) =>
      n === def.name ? def : null,
    );
    return ctx;
  };

  describe('search', () => {
    it('appends a non-negotiable owner filter for an owner-scoped collection', async () => {
      const { service, engine } = withCollection(ownerScoped);
      await service.search('documents', { q: '', page: 1 }, READER);
      expect(engine.search).toHaveBeenCalledWith(
        'documents',
        expect.objectContaining({ filter: ['ownerUserId = "u-1"'] }),
      );
    });

    // A caller supplying their own owner filter cannot widen the scope: Meili
    // ANDs the array, so `ownerUserId = "u-2" AND ownerUserId = "u-1"` matches
    // nothing rather than returning u-2's records.
    it('keeps the injected filter alongside a caller-supplied one', async () => {
      const { service, engine } = withCollection(ownerScoped);
      await service.search(
        'documents',
        { q: '', page: 1, filters: { ownerUserId: 'u-2' } },
        READER,
      );
      const [, req] = (engine.search as jest.Mock).mock.calls[0];
      expect(req.filter).toEqual([
        'ownerUserId = "u-2"',
        'ownerUserId = "u-1"',
      ]);
    });

    it('does not filter for an admin', async () => {
      const { service, engine } = withCollection(ownerScoped);
      await service.search('documents', { q: '', page: 1 }, ADMIN);
      const [, req] = (engine.search as jest.Mock).mock.calls[0];
      expect(req.filter).toBeUndefined();
    });

    // The headline regression: any authenticated user could read every inbound
    // email body through the generic query endpoint.
    it('refuses a private collection to a non-admin and never reaches the engine', async () => {
      const { service, engine } = withCollection(privateCollection);
      await expect(
        service.search('inbound_email', { q: '', page: 1 }, READER),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(engine.search).not.toHaveBeenCalled();
    });

    it('allows an admin to read a private collection', async () => {
      const { service, engine } = withCollection(privateCollection);
      await service.search('inbound_email', { q: '', page: 1 }, ADMIN);
      expect(engine.search).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    const row = (ownerUserId: string) => ({
      id: '11111111-1111-4111-8111-111111111111',
      collection: 'documents',
      externalId: 'file-1',
      document: { title: 'T', ownerUserId },
      indexState: 'INDEXED',
      indexError: null,
      indexAttempts: 1,
      indexedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: false,
    });

    it('returns the record to its owner', async () => {
      const { service } = withCollection(ownerScoped, {
        findLiveByExternalId: jest.fn(async () => row('u-1')),
      });
      await expect(
        service.get('documents', 'file-1', READER),
      ).resolves.toMatchObject({ externalId: 'file-1' });
    });

    // `externalId` for a document IS the fileId, so an unscoped read here leaks
    // another user's extracted text just as effectively as an unscoped query.
    it('404s another user’s record rather than revealing it exists', async () => {
      const { service } = withCollection(ownerScoped, {
        findLiveByExternalId: jest.fn(async () => row('u-1')),
      });
      await expect(
        service.get('documents', 'file-1', OTHER),
      ).rejects.toMatchObject({ code: ErrorCode.SEARCH_RECORD_NOT_FOUND });
    });

    it('lets an admin read any record', async () => {
      const { service } = withCollection(ownerScoped, {
        findLiveByExternalId: jest.fn(async () => row('u-1')),
      });
      await expect(
        service.get('documents', 'file-1', ADMIN),
      ).resolves.toMatchObject({ externalId: 'file-1' });
    });

    it('refuses a private collection before touching the database', async () => {
      const findLiveByExternalId = jest.fn();
      const { service } = withCollection(privateCollection, {
        findLiveByExternalId,
      });
      await expect(
        service.get('inbound_email', 'x', READER),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(findLiveByExternalId).not.toHaveBeenCalled();
    });
  });

  describe('persist', () => {
    it('rejects an owner-scoped document with no owner field', async () => {
      const { service } = withCollection(ownerScoped);
      await expect(
        service.persist('documents', [{ document: { title: 'T' } }]),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('rejects an owner-scoped document whose owner field is empty', async () => {
      const { service } = withCollection(ownerScoped);
      await expect(
        service.persist('documents', [
          { document: { title: 'T', ownerUserId: '' } },
        ]),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });
});
