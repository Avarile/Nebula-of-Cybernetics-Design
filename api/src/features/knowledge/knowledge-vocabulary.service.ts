import { Injectable } from '@nestjs/common';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  KnowledgeCategoryRow,
  KnowledgeTypeRow,
} from '../../infrastructure/database/schema/knowledge.schema';
import {
  childPath,
  rewriteDepth,
  rewritePath,
  wouldCycle,
} from '../shared/materialized-path.util';
import { deriveKey, keyConflictMessage } from '../shared/vocabulary-key.util';
import { KnowledgeVocabularyRepository } from './knowledge-vocabulary.repository';
import type {
  CreateCategoryDto,
  CreateKnowledgeTypeDto,
  UpdateCategoryDto,
  UpdateKnowledgeTypeDto,
} from './dto/vocabulary.dto';

const MAX_DEPTH = 5;

@Injectable()
export class KnowledgeVocabularyService {
  constructor(
    private readonly repo: KnowledgeVocabularyRepository,
    private readonly errors: ExceptionService,
  ) {}

  listTypes(): Promise<KnowledgeTypeRow[]> {
    return this.repo.listTypes();
  }

  async createType(dto: CreateKnowledgeTypeDto): Promise<KnowledgeTypeRow> {
    const key = deriveKey(dto);
    if (await this.repo.findTypeByKey(key)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: keyConflictMessage('Knowledge type', key, dto),
      });
    }
    // `key` after the spread: an explicit `{ key: undefined }` would otherwise
    // clobber the derived value.
    return this.repo.createType({ ...dto, key });
  }

  async updateType(
    id: string,
    dto: UpdateKnowledgeTypeDto,
  ): Promise<KnowledgeTypeRow> {
    await this.requireMutableType(id);
    const row = await this.repo.updateType(id, dto);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async removeType(id: string): Promise<void> {
    await this.requireMutableType(id);
    await this.repo.softDeleteType(id);
  }

  private async requireMutableType(id: string): Promise<KnowledgeTypeRow> {
    const row = await this.repo.findTypeById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (row.isSystem) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `"${row.key}" is a system type and cannot be changed`,
      });
    }
    return row;
  }

  listCategories(): Promise<KnowledgeCategoryRow[]> {
    return this.repo.listCategories();
  }

  async createCategory(dto: CreateCategoryDto): Promise<KnowledgeCategoryRow> {
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
  ): Promise<KnowledgeCategoryRow> {
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
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Category has ${descendants.length} descendant(s); remove them first`,
      });
    }
    await this.repo.softDeleteCategory(id);
  }

  /** Re-parent a node and rewrite its subtree in one pass. See the helpers. */
  private async moveSubtree(
    node: KnowledgeCategoryRow,
    parentId: string | null,
  ): Promise<void> {
    const parent = parentId ? await this.requireCategory(parentId) : null;
    if (parent) {
      if (parent.id === node.id || wouldCycle(node.path, parent.path)) {
        throw this.errors.validation([
          {
            path: 'parentId',
            message: 'Cannot move a category beneath itself or its descendant',
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

  private async requireCategory(id: string): Promise<KnowledgeCategoryRow> {
    const row = await this.repo.findCategoryById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }
}
