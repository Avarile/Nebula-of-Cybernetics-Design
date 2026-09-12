import type { ConfigService } from '@nestjs/config';
import { SearchEngineService } from './search-engine.service';
import { SearchEngineError } from './search-engine.interface';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

function makeClient() {
  const index = {
    updateSettings: jest.fn(async () => ({ taskUid: 2 })),
    addDocuments: jest.fn(async () => ({ taskUid: 3 })),
    updateDocuments: jest.fn(async () => ({ taskUid: 4 })),
    deleteDocuments: jest.fn(async () => ({ taskUid: 5 })),
    deleteAllDocuments: jest.fn(async () => ({ taskUid: 6 })),
    getRawInfo: jest.fn<Promise<{ primaryKey: string | null }>, []>(
      async () => ({
        primaryKey: 'id',
      }),
    ),
    getSettings: jest.fn<
      Promise<{
        filterableAttributes: string[];
        sortableAttributes: string[];
        searchableAttributes: string[];
      }>,
      []
    >(async () => ({
      filterableAttributes: ['ownerId'],
      sortableAttributes: ['createdAt'],
      searchableAttributes: ['title'],
    })),
    search: jest.fn(async () => ({
      hits: [{ id: 'a' }],
      totalHits: 1,
      totalPages: 1,
      hitsPerPage: 20,
      page: 1,
      processingTimeMs: 3,
    })),
  };
  return {
    index: jest.fn(() => index),
    createIndex: jest.fn(async () => ({ taskUid: 1 })),
    deleteIndex: jest.fn(async () => ({ taskUid: 7 })),
    updateIndex: jest.fn(async () => ({ taskUid: 8 })),
    isHealthy: jest.fn(async () => true),
    tasks: {
      waitForTask: jest.fn(async () => ({
        status: 'succeeded',
        error: undefined as { message: string; code: string } | undefined,
      })),
    },
    __index: index,
  };
}

const config = {
  getOrThrow: () => ({
    indexPrefix: 'test_',
    taskTimeoutMs: 1000,
    maxTotalHits: 10_000,
  }),
} as unknown as ConfigService;

function definition() {
  return {
    name: 'docs',
    primaryKey: 'id',
    searchableAttributes: ['title'],
    filterableAttributes: ['ownerId'],
    sortableAttributes: ['createdAt'],
  };
}

describe('SearchEngineService', () => {
  let client: ReturnType<typeof makeClient>;
  let service: SearchEngineService;

  beforeEach(() => {
    client = makeClient();
    service = new SearchEngineService(client as any, config);
  });

  it('ensureIndex applies the prefix, creates, and updates settings', async () => {
    await service.ensureIndex({
      name: 'docs',
      primaryKey: 'id',
      searchableAttributes: ['title'],
      filterableAttributes: ['ownerId'],
      sortableAttributes: ['createdAt'],
    });
    expect(client.createIndex).toHaveBeenCalledWith('test_docs', {
      primaryKey: 'id',
    });
    expect(client.index).toHaveBeenCalledWith('test_docs');
    expect(client.__index.updateSettings).toHaveBeenCalled();
  });

  it('ensureIndex tolerates an already-existing index', async () => {
    client.createIndex.mockRejectedValueOnce({ code: 'index_already_exists' });
    await expect(
      service.ensureIndex({
        name: 'docs',
        primaryKey: 'id',
        searchableAttributes: [],
        filterableAttributes: [],
        sortableAttributes: [],
      }),
    ).resolves.toBeUndefined();
    expect(client.__index.updateSettings).toHaveBeenCalled();
  });

  // meilisearch@0.45 puts the code on `cause` for a REST rejection, and on the
  // error itself for a failed task. Reading only one shape silently misclassifies
  // the other, which is how a deleted index once read as an unexpected failure.
  it('recognises an already-exists error reported via `cause`', async () => {
    client.createIndex.mockRejectedValueOnce({
      name: 'MeiliSearchApiError',
      cause: { code: 'index_already_exists' },
    });
    await expect(service.ensureIndex(definition())).resolves.toBeUndefined();
    expect(client.__index.updateSettings).toHaveBeenCalled();
  });

  describe('needsEnsure', () => {
    it('is false when the index already matches the definition', async () => {
      expect(await service.needsEnsure(definition())).toBe(false);
    });

    it('is true when the index is missing, reported via `cause`', async () => {
      client.__index.getSettings.mockRejectedValueOnce({
        name: 'MeiliSearchApiError',
        cause: { code: 'index_not_found' },
      } as never);
      expect(await service.needsEnsure(definition())).toBe(true);
    });

    // A write against a missing index makes the engine create one with default
    // settings and *succeed*, so records look indexed while every filter fails
    // at query time. Existence alone cannot detect that; the settings can.
    it('is true for an index left with default settings', async () => {
      client.__index.getSettings.mockResolvedValueOnce({
        filterableAttributes: [],
        sortableAttributes: [],
        searchableAttributes: ['*'],
      });
      expect(await service.needsEnsure(definition())).toBe(true);
    });

    it('is true when a required filterable attribute is missing', async () => {
      client.__index.getSettings.mockResolvedValueOnce({
        filterableAttributes: ['somethingElse'],
        sortableAttributes: ['createdAt'],
        searchableAttributes: ['title'],
      });
      expect(await service.needsEnsure(definition())).toBe(true);
    });

    /**
     * Previously a superset was accepted as "already converged". That made a
     * narrowing change permanent: drop `filterable` from a field and the
     * attribute stayed filterable in Meili forever, because the stale
     * configuration still covered the new spec. Since the filterable list is
     * also the query allowlist, the field remained queryable after the spec
     * said it should not be.
     */
    it('re-ensures an index holding MORE attributes than required', async () => {
      client.__index.getSettings.mockResolvedValueOnce({
        filterableAttributes: ['ownerId', 'extra'],
        sortableAttributes: ['createdAt', 'extra'],
        searchableAttributes: ['title', 'extra'],
      });
      expect(await service.needsEnsure(definition())).toBe(true);
    });

    it('reports converged when the attributes match exactly', async () => {
      client.__index.getSettings.mockResolvedValueOnce({
        filterableAttributes: ['ownerId'],
        sortableAttributes: ['createdAt'],
        searchableAttributes: ['title'],
      });
      expect(await service.needsEnsure(definition())).toBe(false);
    });

    it('ignores attribute ordering', async () => {
      client.__index.getSettings.mockResolvedValueOnce({
        filterableAttributes: ['ownerId'],
        sortableAttributes: ['createdAt'],
        searchableAttributes: ['title'],
      });
      expect(await service.needsEnsure(definition())).toBe(false);
    });

    it('rethrows anything that is not a missing index', async () => {
      client.__index.getSettings.mockRejectedValueOnce({
        cause: { code: 'internal' },
      } as never);
      await expect(service.needsEnsure(definition())).rejects.toBeInstanceOf(
        SearchEngineError,
      );
    });
  });

  // An index auto-created by a document write has no primary key, and nothing
  // else can add one: createIndex no-ops and updateSettings does not cover it.
  // Every later write then fails on ambiguous inference, permanently.
  describe('primary key repair', () => {
    it('sets the primary key on an existing index that has none', async () => {
      client.createIndex.mockRejectedValueOnce({
        cause: { code: 'index_already_exists' },
      });
      client.__index.getRawInfo.mockResolvedValueOnce({ primaryKey: null });
      await service.ensureIndex(definition());
      expect(client.updateIndex).toHaveBeenCalledWith('test_docs', {
        primaryKey: 'id',
      });
    });

    it('leaves a correct primary key alone', async () => {
      client.createIndex.mockRejectedValueOnce({
        cause: { code: 'index_already_exists' },
      });
      client.__index.getRawInfo.mockResolvedValueOnce({ primaryKey: 'id' });
      await service.ensureIndex(definition());
      expect(client.updateIndex).not.toHaveBeenCalled();
    });

    it('does not run for a freshly created index', async () => {
      await service.ensureIndex(definition());
      expect(client.updateIndex).not.toHaveBeenCalled();
    });

    // Meili refuses the change while the index holds documents — but then it
    // already has a working key, so failing the write would be worse.
    it('warns instead of throwing when the repair is rejected', async () => {
      client.createIndex.mockRejectedValueOnce({
        cause: { code: 'index_already_exists' },
      });
      client.__index.getRawInfo.mockResolvedValueOnce({ primaryKey: null });
      client.updateIndex.mockRejectedValueOnce(new Error('index not empty'));
      await expect(service.ensureIndex(definition())).resolves.toBeUndefined();
      expect(client.__index.updateSettings).toHaveBeenCalled();
    });
  });

  // Without an explicit primary key the engine has to infer one, and a document
  // carrying both `id` and `externalId` makes that ambiguous — the write then
  // fails forever and can leave a keyless index behind.
  it('addOrReplace forwards the primary key', async () => {
    await service.addOrReplace('docs', [{ id: '1' }], { primaryKey: 'id' });
    expect(client.__index.addDocuments).toHaveBeenCalledWith([{ id: '1' }], {
      primaryKey: 'id',
    });
  });

  it('update forwards the primary key', async () => {
    await service.update('docs', [{ id: '1' }], { primaryKey: 'id' });
    expect(client.__index.updateDocuments).toHaveBeenCalledWith([{ id: '1' }], {
      primaryKey: 'id',
    });
  });

  it('search maps the response into EngineResult', async () => {
    const res = await service.search('docs', {
      q: 'hi',
      page: 1,
      hitsPerPage: 20,
    });
    expect(res.hits).toEqual([{ id: 'a' }]);
    expect(res.totalHits).toBe(1);
    expect(res.totalPages).toBe(1);
  });

  it('deleteIndex deletes the prefixed index and returns the task ref', async () => {
    const ref = await service.deleteIndex('articles');
    expect(client.deleteIndex).toHaveBeenCalledWith('test_articles');
    expect(ref).toEqual({ taskUid: 7 });
  });

  it('waitForTask throws SearchEngineError when a task fails', async () => {
    client.tasks.waitForTask.mockResolvedValueOnce({
      status: 'failed',
      error: { message: 'boom', code: 'bad' },
    });
    await expect(service.waitForTask(9)).rejects.toBeInstanceOf(
      SearchEngineError,
    );
  });

  it('health returns false when the client throws', async () => {
    client.isHealthy.mockRejectedValueOnce(new Error('down'));
    expect(await service.health()).toBe(false);
  });
});
