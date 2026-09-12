import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, like } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  contactCategories,
  contactTypes,
  type ContactCategoryRow,
  type ContactTypeRow,
  type NewContactCategoryRow,
  type NewContactTypeRow,
} from '../../infrastructure/database/schema/contact.schema';

/** Types and the category tree. Both are admin-curated vocabularies. */
@Injectable()
export class ContactVocabularyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async listTypes(): Promise<ContactTypeRow[]> {
    return this.db
      .select()
      .from(contactTypes)
      .where(eq(contactTypes.isDeleted, false))
      .orderBy(asc(contactTypes.sortOrder), asc(contactTypes.key));
  }

  async findTypeById(id: string): Promise<ContactTypeRow | null> {
    const rows = await this.db
      .select()
      .from(contactTypes)
      .where(and(eq(contactTypes.id, id), eq(contactTypes.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findTypeByKey(key: string): Promise<ContactTypeRow | null> {
    const rows = await this.db
      .select()
      .from(contactTypes)
      .where(and(eq(contactTypes.key, key), eq(contactTypes.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createType(values: NewContactTypeRow): Promise<ContactTypeRow> {
    const rows = await this.db.insert(contactTypes).values(values).returning();
    return rows[0];
  }

  async updateType(
    id: string,
    patch: Partial<NewContactTypeRow>,
  ): Promise<ContactTypeRow | null> {
    const rows = await this.db
      .update(contactTypes)
      .set(patch)
      .where(and(eq(contactTypes.id, id), eq(contactTypes.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteType(id: string): Promise<void> {
    await this.db
      .update(contactTypes)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(contactTypes.id, id));
  }

  // --- categories ---

  async listCategories(): Promise<ContactCategoryRow[]> {
    return this.db
      .select()
      .from(contactCategories)
      .where(eq(contactCategories.isDeleted, false))
      .orderBy(asc(contactCategories.path));
  }

  async findCategoryById(id: string): Promise<ContactCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(contactCategories)
      .where(
        and(
          eq(contactCategories.id, id),
          eq(contactCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCategoryByKey(key: string): Promise<ContactCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(contactCategories)
      .where(
        and(
          eq(contactCategories.key, key),
          eq(contactCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Every node at or below a path — one index range scan.
   *
   * This is the whole reason `path` is materialized: without it, "all contacts
   * under Manufacturing" is a recursive CTE per query.
   */
  async subtree(path: string): Promise<ContactCategoryRow[]> {
    return this.db
      .select()
      .from(contactCategories)
      .where(
        and(
          like(contactCategories.path, `${path}%`),
          eq(contactCategories.isDeleted, false),
        ),
      )
      .orderBy(asc(contactCategories.path));
  }

  async createCategory(
    values: NewContactCategoryRow,
  ): Promise<ContactCategoryRow> {
    const rows = await this.db
      .insert(contactCategories)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateCategory(
    id: string,
    patch: Partial<NewContactCategoryRow>,
  ): Promise<ContactCategoryRow | null> {
    const rows = await this.db
      .update(contactCategories)
      .set(patch)
      .where(
        and(
          eq(contactCategories.id, id),
          eq(contactCategories.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteCategory(id: string): Promise<void> {
    await this.db
      .update(contactCategories)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(contactCategories.id, id));
  }
}
