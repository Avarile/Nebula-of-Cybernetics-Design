import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  collections,
  type CollectionRow,
  type NewCollectionRow,
} from '../../infrastructure/database/schema/search.schema';

/** Repository for the `collections` table. */
@Injectable()
export class CollectionRepository extends BaseRepository<typeof collections> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, collections);
  }

  /** A live collection by its unique name. */
  async findByName(name: string): Promise<CollectionRow | null> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(and(eq(collections.name, name), eq(collections.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** All live collections, newest first. */
  async listActive(): Promise<CollectionRow[]> {
    return this.db
      .select()
      .from(collections)
      .where(eq(collections.isDeleted, false))
      .orderBy(desc(collections.createdAt));
  }

  async updateByName(
    name: string,
    patch: Partial<NewCollectionRow>,
  ): Promise<CollectionRow | null> {
    const rows = await this.db
      .update(collections)
      .set(patch)
      .where(and(eq(collections.name, name), eq(collections.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteByName(name: string): Promise<void> {
    await this.db
      .update(collections)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(collections.name, name));
  }
}
