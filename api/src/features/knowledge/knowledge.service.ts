import { Injectable, Logger } from '@nestjs/common';
import { isAdmin, userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { KnowledgeRow } from '../../infrastructure/database/schema/knowledge.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import { TagService } from '../shared/tag.service';
import { slugify } from '../shared/slug.util';
import type {
  CreateKnowledgeDto,
  ListKnowledgeDto,
  TransitionKnowledgeDto,
  UpdateKnowledgeDto,
} from './dto/knowledge.dto';
import { KnowledgeAclRepository } from './knowledge-acl.repository';
import {
  permits,
  resolveKnowledgeAccess,
  type KnowledgeAccess,
  type KnowledgePermission,
} from './knowledge-access.resolver';
import { KnowledgeProjectionService } from './knowledge-projection.service';
import { KnowledgeVocabularyRepository } from './knowledge-vocabulary.repository';
import {
  KnowledgeRepository,
  type KnowledgeQuery,
} from './knowledge.repository';

/**
 * Room for `uniqueSlug`'s suffix inside the column's 255, so a derived slug
 * that collides can still grow a `-2` without truncation.
 */
const SLUG_MAX_LENGTH = 200;

export interface PublicKnowledge {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string | null;
  format: KnowledgeRow['format'];
  status: KnowledgeRow['status'];
  visibility: KnowledgeRow['visibility'];
  version: number;
  typeId: string | null;
  categoryId: string | null;
  ownerUserId: string | null;
  sourceUrl: string | null;
  sourceFileId: string | null;
  language: string;
  publishedAt: Date | null;
  reviewDueAt: Date | null;
  tagIds: string[];
  /** What the asking principal may do — so a client need not guess. */
  access: KnowledgeAccess;
  updatedAt: Date;
}

/** Status transitions the service will perform, and what each requires. */
const TRANSITIONS: Record<
  KnowledgeRow['status'],
  { from: KnowledgeRow['status'][]; needs: KnowledgePermission }
> = {
  draft: { from: ['in_review', 'archived'], needs: 'write' },
  in_review: { from: ['draft'], needs: 'write' },
  published: { from: ['draft', 'in_review', 'archived'], needs: 'manage' },
  archived: { from: ['draft', 'in_review', 'published'], needs: 'manage' },
  deprecated: { from: ['published', 'archived'], needs: 'manage' },
};

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly acl: KnowledgeAclRepository,
    private readonly vocabulary: KnowledgeVocabularyRepository,
    private readonly projection: KnowledgeProjectionService,
    private readonly tags: TagService,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(
    row: KnowledgeRow,
    access: KnowledgeAccess,
    tagIds: string[] = [],
    includeBody = true,
  ): PublicKnowledge {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      summary: row.summary ?? null,
      // A list view returns summaries only: shipping every body turns a page of
      // twenty into megabytes.
      body: includeBody ? (row.body ?? null) : null,
      format: row.format,
      status: row.status,
      visibility: row.visibility,
      version: row.version,
      typeId: row.typeId ?? null,
      categoryId: row.categoryId ?? null,
      ownerUserId: row.ownerUserId ?? null,
      sourceUrl: row.sourceUrl ?? null,
      sourceFileId: row.sourceFileId ?? null,
      language: row.language,
      publishedAt: row.publishedAt ?? null,
      reviewDueAt: row.reviewDueAt ?? null,
      tagIds,
      access,
      updatedAt: row.updatedAt,
    };
  }

  async create(
    dto: CreateKnowledgeDto,
    principal: Principal,
  ): Promise<PublicKnowledge> {
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'knowledge');
    }
    const slug = await this.uniqueSlug(
      dto.slug ?? slugify(dto.title, SLUG_MAX_LENGTH),
    );
    const reviewDueAt =
      dto.reviewDueAt ?? (await this.defaultReviewDue(dto.typeId));

    const { tagIds, ...rest } = dto;
    const row = await this.repo.create({
      ...rest,
      slug,
      reviewDueAt,
      ownerUserId: userIdOrNull(principal),
      authorUserId: userIdOrNull(principal),
    });
    if (tagIds?.length) {
      await this.repo.setTags(row.id, tagIds, userIdOrNull(principal));
    }
    await this.projection.project(row.id);
    await this.activity.recordSafe({
      principal,
      entityType: 'knowledge',
      entityId: row.id,
      action: 'knowledge.created',
      summary: row.title,
    });
    return this.toPublic(row, 'manage', tagIds ?? []);
  }

  /**
   * A page of records the caller may read.
   *
   * Grants are fetched for the whole page in one query, then the resolver runs
   * per row. The alternative — filtering in SQL — would mean expressing the
   * grant policy twice, and the two would drift.
   *
   * The page is filtered after the fact, so `total` is the unfiltered count;
   * it is reported as `totalBeforeAccess` rather than passed off as the number
   * of readable records.
   */
  async list(dto: ListKnowledgeDto, principal: Principal) {
    const query: KnowledgeQuery = dto;
    const { rows, total } = await this.repo.list(query);
    const grants = await this.acl.grantsForMany(rows.map((r) => r.id));
    const roleIds =
      principal.kind === 'user'
        ? await this.acl.roleIdsForUser(principal.userId)
        : [];

    const visible = rows
      .map((row) => ({
        row,
        access: resolveKnowledgeAccess(
          row,
          principal,
          grants.get(row.id) ?? [],
          roleIds,
        ),
      }))
      .filter((r) => r.access !== 'none');

    return {
      data: visible.map((v) => this.toPublic(v.row, v.access, [], false)),
      total: visible.length,
      totalBeforeAccess: total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async get(id: string, principal: Principal): Promise<PublicKnowledge> {
    const { row, access } = await this.require(id, principal, 'read');
    const tagIds = await this.repo.tagIdsFor(id);
    // Ranking hint only; never authoritative, and rebuildable from activity.
    await this.repo.bumpViewCount(id);
    return this.toPublic(row, access, tagIds);
  }

  async update(
    id: string,
    dto: UpdateKnowledgeDto,
    principal: Principal,
  ): Promise<PublicKnowledge> {
    const { row, access } = await this.require(id, principal, 'write');
    if (
      dto.expectedVersion !== undefined &&
      dto.expectedVersion !== row.version
    ) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Record is at version ${row.version}, not ${dto.expectedVersion}`,
      });
    }
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'knowledge');
    }
    // Only an owner or admin may hand a record to someone else.
    if (dto.ownerUserId !== undefined && access !== 'manage') {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Changing the owner requires manage access',
      });
    }

    const { tagIds, expectedVersion, ...rest } = dto;
    void expectedVersion; // already checked above; must not reach the patch
    const bumpsVersion = rest.body !== undefined || rest.title !== undefined;
    const updated = await this.repo.update(id, {
      ...rest,
      ...(bumpsVersion ? { version: row.version + 1 } : {}),
    });
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (tagIds) {
      await this.repo.setTags(id, tagIds, userIdOrNull(principal));
    }
    await this.projection.project(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'knowledge',
      entityId: id,
      action: 'knowledge.updated',
    });
    return this.toPublic(updated, access, tagIds ?? []);
  }

  /**
   * Move a record through its lifecycle.
   *
   * A separate route from `update` because the transitions are a state machine
   * with their own permission requirements — publishing is `manage`, editing is
   * `write` — and burying that in a generic PATCH hides it.
   */
  async transition(
    id: string,
    dto: TransitionKnowledgeDto,
    principal: Principal,
  ): Promise<PublicKnowledge> {
    const rule = TRANSITIONS[dto.status];
    const { row, access } = await this.require(id, principal, rule.needs);
    if (row.status === dto.status) {
      return this.toPublic(row, access, await this.repo.tagIdsFor(id));
    }
    if (!rule.from.includes(row.status)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Cannot move from "${row.status}" to "${dto.status}"`,
      });
    }

    const patch: Record<string, unknown> = { status: dto.status };
    if (dto.status === 'published') {
      patch.publishedAt = new Date();
      patch.reviewDueAt =
        row.reviewDueAt ?? (await this.defaultReviewDue(row.typeId));
    }
    if (dto.status === 'in_review') {
      patch.reviewerUserId = userIdOrNull(principal);
    }

    const updated = await this.repo.update(id, patch);
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projection.project(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'knowledge',
      entityId: id,
      action: `knowledge.${dto.status}`,
      summary: dto.note ?? undefined,
      changes: { status: { from: row.status, to: dto.status } },
    });
    return this.toPublic(updated, access);
  }

  async remove(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'manage');
    await this.repo.softDelete(id);
    await this.cascade.purgeFor('knowledge', id);
    await this.projection.remove(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'knowledge',
      entityId: id,
      action: 'knowledge.deleted',
    });
  }

  /** Whether a principal may read a record — the registry's resolver. */
  async canRead(id: string, principal: Principal): Promise<boolean> {
    const row = await this.repo.findLiveById(id);
    if (!row) return false;
    const access = await this.accessFor(row, principal);
    return access !== 'none';
  }

  /** Load a record and assert the caller holds at least `needed`. */
  async require(
    id: string,
    principal: Principal,
    needed: KnowledgePermission,
  ): Promise<{ row: KnowledgeRow; access: KnowledgeAccess }> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    const access = await this.accessFor(row, principal);
    // A caller who cannot read it must not learn it exists.
    if (access === 'none') throw this.errors.create(ErrorCode.NOT_FOUND);
    if (!permits(access, needed)) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `This action requires "${needed}" access`,
      });
    }
    return { row, access };
  }

  private async accessFor(
    row: KnowledgeRow,
    principal: Principal,
  ): Promise<KnowledgeAccess> {
    // Short-circuit before two queries: admins and pipelines always pass.
    if (isAdmin(principal) || principal.kind === 'system') return 'manage';
    const [grants, roleIds] = await Promise.all([
      this.acl.grantsFor(row.id),
      principal.kind === 'user'
        ? this.acl.roleIdsForUser(principal.userId)
        : Promise.resolve([]),
    ]);
    return resolveKnowledgeAccess(row, principal, grants, roleIds);
  }

  /**
   * Append a numeric suffix until the slug is free.
   *
   * Bounded, and falls back to a timestamp: an unbounded loop against a unique
   * index is a hang waiting for a pathological title.
   */
  private async uniqueSlug(base: string): Promise<string> {
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      if (!(await this.repo.findBySlug(candidate))) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  /** A type's review interval, so a policy is re-checked and a note is not. */
  private async defaultReviewDue(
    typeId: string | null | undefined,
  ): Promise<Date | null> {
    if (!typeId) return null;
    const type = await this.vocabulary.findTypeById(typeId);
    if (!type?.defaultReviewIntervalDays) return null;
    return new Date(
      Date.now() + type.defaultReviewIntervalDays * 24 * 60 * 60 * 1000,
    );
  }
}
