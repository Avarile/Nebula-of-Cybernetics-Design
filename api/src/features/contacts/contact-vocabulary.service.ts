import { Injectable } from '@nestjs/common';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  ContactCategoryRow,
  ContactTypeRow,
} from '../../infrastructure/database/schema/contact.schema';
import {
  childPath,
  rewriteDepth,
  rewritePath,
  wouldCycle,
} from '../shared/materialized-path.util';
import { deriveKey, keyConflictMessage } from '../shared/vocabulary-key.util';
import { ContactVocabularyRepository } from './contact-vocabulary.repository';
import type {
  CreateCategoryDto,
  CreateContactTypeDto,
  UpdateCategoryDto,
  UpdateContactTypeDto,
} from './dto/vocabulary.dto';

/** Depth ceiling, so a subtree rewrite stays bounded. */
const MAX_DEPTH = 5;

@Injectable()
export class ContactVocabularyService {
  constructor(
    private readonly repo: ContactVocabularyRepository,
    private readonly errors: ExceptionService,
  ) {}

  // --- types ---

  listTypes(): Promise<ContactTypeRow[]> {
    return this.repo.listTypes();
  }

  async createType(dto: CreateContactTypeDto): Promise<ContactTypeRow> {
    const key = deriveKey(dto);
    if (await this.repo.findTypeByKey(key)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: keyConflictMessage('Contact type', key, dto),
      });
    }
    // `key` after the spread: an explicit `{ key: undefined }` would otherwise
    // clobber the derived value.
    return this.repo.createType({ ...dto, key });
  }

  async updateType(
    id: string,
    dto: UpdateContactTypeDto,
  ): Promise<ContactTypeRow> {
    await this.requireMutableType(id);
    const row = await this.repo.updateType(id, dto);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async removeType(id: string): Promise<void> {
    await this.requireMutableType(id);
    await this.repo.softDeleteType(id);
  }

  private async requireMutableType(id: string): Promise<ContactTypeRow> {
    const row = await this.repo.findTypeById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (row.isSystem) {
      // Seeded vocabulary is referenced by key from code and from imports.
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `"${row.key}" is a system type and cannot be changed`,
      });
    }
    return row;
  }

  // --- categories ---

  listCategories(): Promise<ContactCategoryRow[]> {
    return this.repo.listCategories();
  }

  async createCategory(dto: CreateCategoryDto): Promise<ContactCategoryRow> {
    const key = deriveKey(dto);
    if (await this.repo.findCategoryByKey(key)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: keyConflictMessage('Category', key, dto),
      });
    }
    const parent = dto.parentId
      ? await this.requireCategory(dto.parentId)
      : null;
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > MAX_DEPTH) {
      throw this.errors.validation([
        {
          path: 'parentId',
          message: `Categories nest at most ${MAX_DEPTH} deep`,
        },
      ]);
    }
    return this.repo.createCategory({
      ...dto,
      key,
      depth,
      path: childPath(parent?.path ?? null, key),
    });
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<ContactCategoryRow> {
    const existing = await this.requireCategory(id);
    if (existing.isSystem && dto.parentId !== undefined) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'A system category cannot be moved',
      });
    }

    if (dto.parentId !== undefined) {
      await this.moveSubtree(existing, dto.parentId);
    }
    const row = await this.repo.updateCategory(id, {
      name: dto.name,
      description: dto.description,
      sortOrder: dto.sortOrder,
    });
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async removeCategory(id: string): Promise<void> {
    const existing = await this.requireCategory(id);
    const descendants = await this.repo.subtree(`${existing.path}/`);
    if (descendants.length > 0) {
      // Orphaning children would leave rows whose `path` no longer resolves.
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Category has ${descendants.length} descendant(s); remove them first`,
      });
    }
    await this.repo.softDeleteCategory(id);
  }

  /**
   * Re-parent a node and rewrite its subtree's paths in one pass.
   *
   * The cycle check is the reason `path` is worth maintaining: a prospective
   * parent whose path already contains this node's path is a descendant, so the
   * move would detach the tree from its root. Comparing paths answers that in
   * one string test rather than a recursive walk.
   */
  private async moveSubtree(
    node: ContactCategoryRow,
    parentId: string | null,
  ): Promise<void> {
    const parent = parentId ? await this.requireCategory(parentId) : null;
    if (parent) {
      if (parent.id === node.id) {
        throw this.errors.validation([
          { path: 'parentId', message: 'A category cannot be its own parent' },
        ]);
      }
      if (wouldCycle(node.path, parent.path)) {
        throw this.errors.validation([
          {
            path: 'parentId',
            message: 'Cannot move a category beneath its own descendant',
          },
        ]);
      }
    }

    const newPath = childPath(parent?.path ?? null, node.key);
    const newDepth = parent ? parent.depth + 1 : 0;
    const subtree = await this.repo.subtree(node.path);
    const deepest = Math.max(...subtree.map((s) => s.depth)) - node.depth;
    if (newDepth + deepest > MAX_DEPTH) {
      throw this.errors.validation([
        {
          path: 'parentId',
          message: `Categories nest at most ${MAX_DEPTH} deep`,
        },
      ]);
    }

    for (const row of subtree) {
      await this.repo.updateCategory(row.id, {
        path: rewritePath(row.path, node.path, newPath),
        depth: rewriteDepth(row.depth, node.depth, newDepth),
        ...(row.id === node.id ? { parentId } : {}),
      });
    }
  }

  private async requireCategory(id: string): Promise<ContactCategoryRow> {
    const row = await this.repo.findCategoryById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }
}
