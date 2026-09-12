import { AppException } from '../../infrastructure/exceptions/app-exception';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { TagService } from './tag.service';

function makeTag(overrides: Record<string, any> = {}) {
  return {
    id: 't1',
    key: 'urgent',
    label: 'Urgent',
    scope: 'shared',
    color: null,
    description: null,
    usageCount: 0,
    isSystem: false,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('TagService', () => {
  let repo: any;
  let tags: TagService;

  beforeEach(() => {
    repo = {
      findByScopedKey: jest.fn(async () => null),
      findLiveById: jest.fn(async () => makeTag()),
      findManyLive: jest.fn(async () => []),
      create: jest.fn(async (v: any) => makeTag(v)),
      update: jest.fn(async (_id: string, patch: any) => makeTag(patch)),
      softDelete: jest.fn(async () => undefined),
      list: jest.fn(async () => ({ rows: [makeTag()], total: 1 })),
    };
    tags = new TagService(repo, new ExceptionService());
  });

  it('lowercases the key so "Urgent" and "urgent" are one tag', async () => {
    await tags.create(
      { key: 'URGENT', label: 'Urgent', scope: 'shared' } as never,
      'u1',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'urgent' }),
    );
  });

  it('rejects a duplicate key within a scope', async () => {
    repo.findByScopedKey.mockResolvedValueOnce(makeTag());
    await expect(
      tags.create(
        { key: 'urgent', label: 'U', scope: 'shared' } as never,
        null,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.TAG_EXISTS });
  });

  it('refuses to edit or delete a system tag', async () => {
    repo.findLiveById.mockResolvedValue(makeTag({ isSystem: true }));
    await expect(
      tags.update('t1', { label: 'x' } as never),
    ).rejects.toMatchObject({ code: ErrorCode.TAG_IMMUTABLE });
    await expect(tags.remove('t1')).rejects.toMatchObject({
      code: ErrorCode.TAG_IMMUTABLE,
    });
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  describe('resolveForScope', () => {
    it('accepts a tag of the target scope', async () => {
      repo.findManyLive.mockResolvedValueOnce([
        makeTag({ id: 't1', scope: 'contact' }),
      ]);
      await expect(
        tags.resolveForScope(['t1'], 'contact'),
      ).resolves.toHaveLength(1);
    });

    it('accepts a shared tag anywhere', async () => {
      repo.findManyLive.mockResolvedValueOnce([
        makeTag({ id: 't1', scope: 'shared' }),
      ]);
      await expect(
        tags.resolveForScope(['t1'], 'knowledge'),
      ).resolves.toHaveLength(1);
    });

    it('rejects a tag scoped to another domain', async () => {
      // The DB cannot express "this tag's scope must match"; without this the
      // vocabulary silently stops meaning anything.
      repo.findManyLive.mockResolvedValueOnce([
        makeTag({ id: 't1', scope: 'project' }),
      ]);
      await expect(
        tags.resolveForScope(['t1'], 'contact'),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('rejects unknown ids before anything is written', async () => {
      repo.findManyLive.mockResolvedValueOnce([]);
      await expect(
        tags.resolveForScope(['missing'], 'contact'),
      ).rejects.toMatchObject({ code: ErrorCode.TAG_NOT_FOUND });
    });

    it('deduplicates the input', async () => {
      repo.findManyLive.mockResolvedValueOnce([makeTag({ scope: 'shared' })]);
      await tags.resolveForScope(['t1', 't1', 't1'], 'contact');
      expect(repo.findManyLive).toHaveBeenCalledWith(['t1']);
    });
  });
});
