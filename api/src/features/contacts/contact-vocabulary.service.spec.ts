import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ContactVocabularyService } from './contact-vocabulary.service';

function makeCategory(overrides: Record<string, any> = {}) {
  return {
    id: 'cat1',
    key: 'manufacturing',
    name: 'Manufacturing',
    parentId: null,
    path: '/manufacturing',
    depth: 0,
    sortOrder: 0,
    isSystem: false,
    isDeleted: false,
    ...overrides,
  };
}

describe('ContactVocabularyService', () => {
  let repo: any;
  let vocabulary: ContactVocabularyService;

  beforeEach(() => {
    repo = {
      findTypeByKey: jest.fn(async () => null),
      createType: jest.fn(async (v: any) => ({ id: 't1', ...v })),
      findCategoryByKey: jest.fn(async () => null),
      findCategoryById: jest.fn(async () => null),
      createCategory: jest.fn(async (v: any) => ({ id: 'cat1', ...v })),
    };
    vocabulary = new ContactVocabularyService(repo, new ExceptionService());
  });

  describe('createCategory', () => {
    it('derives the key from the name when none is given', async () => {
      const row = await vocabulary.createCategory({
        name: 'Key Accounts',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('key-accounts');
      // The key is the path segment, so derivation decides the path too.
      expect(row.path).toBe('/key-accounts');
      expect(row.depth).toBe(0);
    });

    it('keeps an explicit key over the derivable one', async () => {
      const row = await vocabulary.createCategory({
        key: 'kam',
        name: 'Key Accounts',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('kam');
      expect(row.path).toBe('/kam');
    });

    it('nests a derived key under its parent path', async () => {
      repo.findCategoryById.mockResolvedValue(makeCategory());

      const row = await vocabulary.createCategory({
        name: 'Automotive',
        parentId: 'cat1',
        sortOrder: 0,
      } as never);

      expect(row.path).toBe('/manufacturing/automotive');
      expect(row.depth).toBe(1);
    });

    it('clips a derived key to the column width', async () => {
      const row = await vocabulary.createCategory({
        name: 'A'.repeat(120),
        sortOrder: 0,
      } as never);

      expect(row.key).toHaveLength(60);
    });

    it('names the derived key in the conflict, and how to override it', async () => {
      repo.findCategoryByKey.mockResolvedValue(makeCategory());

      // Never auto-suffixed: the caller is told which key was taken, because
      // a `manufacturing-2` nobody chose is unguessable at the CLI.
      await expect(
        vocabulary.createCategory({
          name: 'Manufacturing',
          sortOrder: 0,
        } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: expect.stringContaining('derived from "Manufacturing"'),
      });
      expect(repo.createCategory).not.toHaveBeenCalled();
    });

    it('reports an explicit collision without the derivation aside', async () => {
      repo.findCategoryByKey.mockResolvedValue(makeCategory());

      await expect(
        vocabulary.createCategory({
          key: 'manufacturing',
          name: 'Anything',
          sortOrder: 0,
        } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: 'Category "manufacturing" already exists',
      });
    });
  });

  describe('createType', () => {
    it('derives the key from the name when none is given', async () => {
      const row = await vocabulary.createType({
        name: 'Channel Partner',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('channel-partner');
      expect(repo.findTypeByKey).toHaveBeenCalledWith('channel-partner');
    });

    it('keeps an explicit key', async () => {
      const row = await vocabulary.createType({
        key: 'reseller',
        name: 'Channel Partner',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('reseller');
    });

    it('conflicts on a taken derived key', async () => {
      repo.findTypeByKey.mockResolvedValue({
        id: 't0',
        key: 'channel-partner',
      });

      await expect(
        vocabulary.createType({
          name: 'Channel Partner',
          sortOrder: 0,
        } as never),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });
});
