import { DocumentsCollectionBootstrap } from './documents-collection.bootstrap';
import { DOCUMENTS_COLLECTION } from './document-ingest.constants';

describe('DocumentsCollectionBootstrap', () => {
  const makeCollections = () => ({
    ensureSystemCollection: jest.fn().mockResolvedValue(undefined),
  });

  it('declares the collection owner-scoped on the ownerUserId field', async () => {
    const collections = makeCollections();
    const boot = new DocumentsCollectionBootstrap(collections as never);
    await boot.onApplicationBootstrap();
    expect(collections.ensureSystemCollection).toHaveBeenCalledTimes(1);
    expect(collections.ensureSystemCollection.mock.calls[0][0]).toMatchObject({
      name: DOCUMENTS_COLLECTION,
      visibility: 'owner_scoped',
      ownerField: 'ownerUserId',
    });
  });

  // The owner field has to exist in the spec, be a string, and be filterable —
  // otherwise the read filter the policy emits is invalid. `validateVisibility`
  // enforces that; this pins the bootstrap's own spec against it.
  it('declares an ownerUserId field the policy can actually filter on', async () => {
    const collections = makeCollections();
    const boot = new DocumentsCollectionBootstrap(collections as never);
    await boot.onApplicationBootstrap();
    const spec = collections.ensureSystemCollection.mock.calls[0][0];
    const owner = spec.fields.find(
      (f: { name: string }) => f.name === spec.ownerField,
    );
    expect(owner).toMatchObject({ type: 'string', filterable: true });
  });

  // Boot ordering against CollectionService/MailboxService is undefined and the
  // database may still be warming up, so one failed attempt used to leave the
  // collection missing until someone restarted the process.
  it('retries a transient failure and succeeds', async () => {
    jest.useFakeTimers();
    try {
      const collections = {
        ensureSystemCollection: jest
          .fn()
          .mockRejectedValueOnce(new Error('db warming up'))
          .mockResolvedValueOnce(undefined),
      };
      const boot = new DocumentsCollectionBootstrap(collections as never);
      const done = boot.onApplicationBootstrap();
      await jest.runAllTimersAsync();
      await done;
      expect(collections.ensureSystemCollection).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up after a bounded number of attempts rather than blocking boot', async () => {
    jest.useFakeTimers();
    try {
      const collections = {
        ensureSystemCollection: jest
          .fn()
          .mockRejectedValue(new Error('db down')),
      };
      const boot = new DocumentsCollectionBootstrap(collections as never);
      const done = boot.onApplicationBootstrap();
      await jest.runAllTimersAsync();
      await expect(done).resolves.toBeUndefined();
      expect(collections.ensureSystemCollection).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  });
});
