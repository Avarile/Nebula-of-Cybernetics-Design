import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, like } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  knowledgeCategories,
  knowledgeTypes,
  type KnowledgeCategoryRow,
  type KnowledgeTypeRow,
  type NewKnowledgeCategoryRow,
  type NewKnowledgeTypeRow,
} from '../../infrastructure/database/schema/knowledge.schema';

/** Knowledge types and the category tree — admin-curated vocabularies. */
@Injectable()
export class KnowledgeVocabularyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listTypes(): Promise<KnowledgeTypeRow[]> {
    return this.db
      .select()
      .from(knowledgeTypes)
      .where(eq(knowledgeTypes.isDeleted, false))
      .orderBy(asc(knowledgeTypes.sortOrder), asc(knowledgeTypes.key));
  }

  async findTypeById(id: string): Promise<KnowledgeTypeRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeTypes)
      .where(
        and(eq(knowledgeTypes.id, id), eq(knowledgeTypes.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findTypeByKey(key: string): Promise<KnowledgeTypeRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeTypes)
      .where(
        and(eq(knowledgeTypes.key, key), eq(knowledgeTypes.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createType(values: NewKnowledgeTypeRow): Promise<KnowledgeTypeRow> {
    const rows = await this.db
      .insert(knowledgeTypes)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateType(
    id: string,
    patch: Partial<NewKnowledgeTypeRow>,
  ): Promise<KnowledgeTypeRow | null> {
    const rows = await this.db
      .update(knowledgeTypes)
      .set(patch)
      .where(
        and(eq(knowledgeTypes.id, id), eq(knowledgeTypes.isDeleted, false)),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteType(id: string): Promise<void> {
    await this.db
      .update(knowledgeTypes)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(knowledgeTypes.id, id));
  }

  listCategories(): Promise<KnowledgeCategoryRow[]> {
    return this.db
      .select()
      .from(knowledgeCategories)
      .where(eq(knowledgeCategories.isDeleted, false))
      .orderBy(asc(knowledgeCategories.path));
  }

  async findCategoryById(id: string): Promise<KnowledgeCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeCategories)
      .where(
        and(
          eq(knowledgeCategories.id, id),
          eq(knowledgeCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCategoryByKey(key: string): Promise<KnowledgeCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeCategories)
      .where(
        and(
          eq(knowledgeCategories.key, key),
          eq(knowledgeCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Every node at or below a path — one index range scan. */
  subtree(path: string): Promise<KnowledgeCategoryRow[]> {
    return this.db
      .select()
      .from(knowledgeCategories)
      .where(
        and(
          like(knowledgeCategories.path, `${path}%`),
          eq(knowledgeCategories.isDeleted, false),
        ),
      )
      .orderBy(asc(knowledgeCategories.path));
  }

  async createCategory(
    values: NewKnowledgeCategoryRow,
  ): Promise<KnowledgeCategoryRow> {
    const rows = await this.db
      .insert(knowledgeCategories)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateCategory(
    id: string,
    patch: Partial<NewKnowledgeCategoryRow>,
  ): Promise<KnowledgeCategoryRow | null> {
    const rows = await this.db
      .update(knowledgeCategories)
      .set(patch)
      .where(
        and(
          eq(knowledgeCategories.id, id),
          eq(knowledgeCategories.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteCategory(id: string): Promise<void> {
    await this.db
      .update(knowledgeCategories)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(knowledgeCategories.id, id));
  }
}
