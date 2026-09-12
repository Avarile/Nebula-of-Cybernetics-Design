import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { IndexRegistry } from './index-registry';
import { CollectionService } from './collection.service';

const fields = [{ name: 'title', type: 'string', searchable: true }] as const;

function make(overrides: { existing?: boolean } = {}) {
  let stored: Record<string, unknown> | null = overrides.existing
    ? { name: 'articles' }
    : null;
  const collectionsRepo = {
    findByName: jest.fn(async () => stored),
    listActive: jest.fn(async () => (stored ? [stored] : [])),
    create: jest.fn(async (v: Record<string, unknown>) => {
      stored = {
        id: 'c1',
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        ...v,
      };
      return stored;
    }),
    updateByName: jest.fn(
      async (name: string, patch: Record<string, unknown>) => {
        stored = { ...(stored ?? {}), ...patch, name };
        return stored;
      },
    ),
    softDeleteByName: jest.fn(async () => undefined),
  };
  const recordsRepo = {
    softDeleteByCollection: jest.fn(async () => undefined),
    markCollectionPurged: jest.fn(async () => undefined),
  };
  const engine = {
    ensureIndex: jest.fn(async () => undefined),
    deleteIndex: jest.fn(async () => ({ taskUid: 1 })),
    clearIndex: jest.fn(async () => ({ taskUid: 2 })),
    waitForTask: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const redis = { duplicate: jest.fn(), publish: jest.fn(async () => 1) };
  const config = { getOrThrow: () => ({ registryTtlMs: 60_000 }) };
  const registry = new IndexRegistry(
    collectionsRepo as never,
    redis as never,
    config as never,
  );
  const service = new CollectionService(
    engine as never,
    collectionsRepo as never,
    recordsRepo as never,
    registry,
    queue as never,
    new ExceptionService(),
  );
  return { service, collectionsRepo, recordsRepo, engine, queue };
}

describe('CollectionService', () => {
  const input = {
    name: 'articles',
    displayName: 'Articles',
    fields: [...fields],
  };

  it('creates a collection and ensures its Meili index', async () => {
    const { service, engine, collectionsRepo } = make();
    const view = await service.create(input as never);
    expect(engine.ensureIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'articles',
        searchableAttributes: ['title'],
      }),
    );
    expect(collectionsRepo.create).toHaveBeenCalled();
    expect(view.name).toBe('articles');
  });

  it('writes the Postgres row before touching Meili', async () => {
    const order: string[] = [];
    const { service, engine, collectionsRepo } = make();
    collectionsRepo.create.mockImplementationOnce(async (v: never) => {
      order.push('db');
      return {
        id: 'c1',
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        ...(v as object),
      };
    });
    engine.ensureIndex.mockImplementationOnce(async () => {
      order.push('meili');
    });
    await service.create(input as never);
    expect(order).toEqual(['db', 'meili']);
  });

  it('clears the index on create so a recycled name cannot inherit documents', async () => {
    const { service, engine } = make();
    await service.create(input as never);
    expect(engine.clearIndex).toHaveBeenCalledWith('articles');
  });

  it('still creates the collection when Meili is unavailable', async () => {
    const { service, engine, collectionsRepo } = make();
    engine.ensureIndex.mockRejectedValueOnce(new Error('meili down'));
    const view = await service.create(input as never);
    expect(view.name).toBe('articles');
    expect(collectionsRepo.create).toHaveBeenCalled();
  });

  it('409s when the collection name already exists', async () => {
    const { service } = make({ existing: true });
    await expect(service.create(input as never)).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_EXISTS,
      message: 'Collection "articles" already exists',
    });
  });

  it('404s getting an unknown collection', async () => {
    const { service } = make();
    await expect(service.get('nope')).rejects.toMatchObject({
      code: ErrorCode.SEARCH_COLLECTION_NOT_FOUND,
      message: 'Unknown collection "nope"',
    });
  });

  it('remove purges records, deletes the index, and invalidates the cache', async () => {
    const { service, engine, recordsRepo, collectionsRepo } = make({
      existing: true,
    });
    await service.remove('articles');
    expect(collectionsRepo.softDeleteByName).toHaveBeenCalledWith('articles');
    expect(recordsRepo.softDeleteByCollection).toHaveBeenCalledWith('articles');
    expect(engine.deleteIndex).toHaveBeenCalledWith('articles');
    // Only an observed drop lets the soft-deleted rows count as converged.
    expect(recordsRepo.markCollectionPurged).toHaveBeenCalledWith('articles');
  });

  it('queues a retry and leaves records unconverged when the index drop fails', async () => {
    const { service, engine, recordsRepo, queue } = make({ existing: true });
    engine.deleteIndex.mockRejectedValueOnce(new Error('meili down'));
    await service.remove('articles');
    expect(recordsRepo.markCollectionPurged).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'drop-index',
      { collection: 'articles' },
      expect.anything(),
    );
  });

  it('update with new fields re-ensures settings and enqueues a reload', async () => {
    const { service, engine, queue } = make({ existing: true });
    await service.update('articles', {
      fields: [
        { name: 'title', type: 'string', searchable: true },
        { name: 'body', type: 'string', searchable: true },
      ],
    } as never);
    expect(engine.ensureIndex).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'reindex-collection',
      { collection: 'articles' },
      expect.anything(),
    );
  });
});
