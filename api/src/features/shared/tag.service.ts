import { Injectable } from '@nestjs/common';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { TagRow } from '../../infrastructure/database/schema/shared.schema';
import type { CreateTagDto, UpdateTagDto } from './dto/tag.dto';
import { TagRepository, type TagQuery } from './tag.repository';

export interface PublicTag {
  id: string;
  key: string;
  label: string;
  scope: TagRow['scope'];
  color: string | null;
  description: string | null;
  usageCount: number;
  isSystem: boolean;
}

/**
 * The shared tag vocabulary.
 *
 * One table serves every module, so "urgent" is a single row with a single id
 * and a cross-domain facet is one query rather than a union of unrelated ids.
 * Per-domain join tables (`knowledge_tags`, `contact_tags`, …) reference it.
 */
@Injectable()
export class TagService {
  constructor(
    private readonly repo: TagRepository,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: TagRow): PublicTag {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      scope: row.scope,
      color: row.color ?? null,
      description: row.description ?? null,
      usageCount: row.usageCount,
      isSystem: row.isSystem,
    };
  }

  async create(
    dto: CreateTagDto,
    createdBy: string | null,
  ): Promise<PublicTag> {
    const key = dto.key.toLowerCase();
    if (await this.repo.findByScopedKey(dto.scope, key)) {
      throw this.errors.create(ErrorCode.TAG_EXISTS, {
        message: `Tag "${key}" already exists in scope "${dto.scope}"`,
      });
    }
    const row = await this.repo.create({
      key,
      label: dto.label,
      scope: dto.scope,
      color: dto.color,
      description: dto.description,
      createdBy,
    });
    return this.toPublic(row);
  }

  async list(q: TagQuery) {
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async get(id: string): Promise<PublicTag> {
    return this.toPublic(await this.requireLive(id));
  }

  async update(id: string, dto: UpdateTagDto): Promise<PublicTag> {
    await this.requireMutable(id);
    const row = await this.repo.update(id, {
      ...(dto.label !== undefined ? { label: dto.label } : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
    });
    if (!row) throw this.errors.create(ErrorCode.TAG_NOT_FOUND);
    return this.toPublic(row);
  }

  async remove(id: string): Promise<void> {
    await this.requireMutable(id);
    await this.repo.softDelete(id);
  }

  /**
   * Resolve tag ids for a tagging operation, rejecting unknown or wrong-scope
   * ids before any join row is written.
   *
   * Scope is enforced here rather than at the join table because the database
   * cannot express "this tag's scope must be `contact` or `shared`" through a
   * foreign key — without this check a project tag could be attached to a
   * contact and the vocabulary would stop meaning anything.
   */
  async resolveForScope(
    ids: string[],
    scope: TagRow['scope'],
  ): Promise<TagRow[]> {
    const unique = [...new Set(ids)];
    const found = await this.repo.findManyLive(unique);
    const missing = unique.filter((id) => !found.some((f) => f.id === id));
    if (missing.length > 0) {
      throw this.errors.create(ErrorCode.TAG_NOT_FOUND, {
        message: `Unknown tag(s): ${missing.join(', ')}`,
      });
    }
    const wrongScope = found.filter(
      (t) => t.scope !== scope && t.scope !== 'shared',
    );
    if (wrongScope.length > 0) {
      throw this.errors.validation(
        wrongScope.map((t) => ({
          path: 'tagIds',
          message: `Tag "${t.key}" is scoped to "${t.scope}", not "${scope}"`,
        })),
      );
    }
    return found;
  }

  private async requireLive(id: string): Promise<TagRow> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.TAG_NOT_FOUND);
    return row;
  }

  /** Seeded vocabulary is referenced by code and must not be edited away. */
  private async requireMutable(id: string): Promise<TagRow> {
    const row = await this.requireLive(id);
    if (row.isSystem) {
      throw this.errors.create(ErrorCode.TAG_IMMUTABLE, {
        message: `Tag "${row.key}" is a system tag`,
      });
    }
    return row;
  }
}
