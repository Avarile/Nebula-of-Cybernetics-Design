import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { KnowledgeVocabularyService } from './knowledge-vocabulary.service';

function makeCategory(overrides: Record<string, any> = {}) {
  return {
    id: 'cat1',
    key: 'engineering',
    name: 'Engineering',
    parentId: null,
    path: '/engineering',
    depth: 0,
    sortOrder: 0,
    isSystem: false,
    isDeleted: false,
    ...overrides,
  };
}

describe('KnowledgeVocabularyService', () => {
  let repo: any;
  let vocabulary: KnowledgeVocabularyService;

  beforeEach(() => {
    repo = {
      findTypeByKey: jest.fn(async () => null),
      createType: jest.fn(async (v: any) => ({ id: 't1', ...v })),
      findCategoryByKey: jest.fn(async () => null),
      findCategoryById: jest.fn(async () => null),
      createCategory: jest.fn(async (v: any) => ({ id: 'cat1', ...v })),
    };
    vocabulary = new KnowledgeVocabularyService(repo, new ExceptionService());
  });

  describe('createCategory', () => {
    it('derives the key from the name when none is given', async () => {
      const row = await vocabulary.createCategory({
        name: 'Engineering Runbooks',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('engineering-runbooks');
      // The key is the path segment, so derivation decides the path too.
      expect(row.path).toBe('/engineering-runbooks');
      expect(row.depth).toBe(0);
    });

    it('keeps an explicit key over the derivable one', async () => {
      const row = await vocabulary.createCategory({
        key: 'ops',
        name: 'Engineering Runbooks',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('ops');
      expect(row.path).toBe('/ops');
    });

    it('nests a derived key under its parent path', async () => {
      repo.findCategoryById.mockResolvedValue(makeCategory());

      const row = await vocabulary.createCategory({
        name: 'Backend',
        parentId: 'cat1',
        sortOrder: 0,
      } as never);

      expect(row.path).toBe('/engineering/backend');
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
      // an `engineering-2` nobody chose is unguessable at the CLI.
      await expect(
        vocabulary.createCategory({
          name: 'Engineering',
          sortOrder: 0,
        } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: expect.stringContaining('derived from "Engineering"'),
      });
      expect(repo.createCategory).not.toHaveBeenCalled();
    });

    it('reports an explicit collision without the derivation aside', async () => {
      repo.findCategoryByKey.mockResolvedValue(makeCategory());

      await expect(
        vocabulary.createCategory({
          key: 'engineering',
          name: 'Anything',
          sortOrder: 0,
        } as never),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: 'Category "engineering" already exists',
      });
    });
  });

  describe('createType', () => {
    it('derives the key from the name when none is given', async () => {
      const row = await vocabulary.createType({
        name: 'Runbook',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('runbook');
      expect(repo.findTypeByKey).toHaveBeenCalledWith('runbook');
    });

    it('keeps an explicit key', async () => {
      const row = await vocabulary.createType({
        key: 'sop',
        name: 'Runbook',
        sortOrder: 0,
      } as never);

      expect(row.key).toBe('sop');
    });

    it('conflicts on a taken derived key', async () => {
      repo.findTypeByKey.mockResolvedValue({ id: 't0', key: 'runbook' });

      await expect(
        vocabulary.createType({ name: 'Runbook', sortOrder: 0 } as never),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });
});
