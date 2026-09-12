import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  projectMembers,
  projectTags,
  projects,
  type NewProjectRow,
  type ProjectMemberRow,
  type ProjectRow,
} from '../../infrastructure/database/schema/project.schema';

/**
 * Assigns `updated_at` to itself, suppressing `baseColumns.updatedAt`'s
 * `$onUpdate` for writes that are not edits. See `allocateTaskNumber` — the
 * same guard `knowledge.bumpViewCount` uses for its counter.
 */
const KEEP_UPDATED_AT = sql`${projects.updatedAt}`;

export interface ProjectQuery {
  search?: string;
  status?: ProjectRow['status'];
  ownerUserId?: string;
  /** Non-admin reads: own, member-of, or internal. */
  visibleTo?: string;
  page: number;
  limit: number;
}

@Injectable()
export class ProjectRepository extends BaseRepository<typeof projects> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, projects);
  }

  async findLiveById(id: string): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByKey(key: string): Promise<ProjectRow | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.key, key), eq(projects.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: ProjectQuery): Promise<{ rows: ProjectRow[]; total: number }> {
    const filters: SQL[] = [eq(projects.isDeleted, false)];
    if (q.status) filters.push(eq(projects.status, q.status));
    if (q.ownerUserId) filters.push(eq(projects.ownerUserId, q.ownerUserId));
    if (q.search) {
      const pattern = `%${q.search}%`;
      filters.push(
        or(ilike(projects.name, pattern), ilike(projects.key, pattern))!,
      );
    }
    // Membership narrowing in SQL, so the page and its total agree. Doing it
    // after the fact silently shrinks pages and misreports the count.
    if (q.visibleTo) {
      filters.push(
        or(
          eq(projects.ownerUserId, q.visibleTo),
          eq(projects.visibility, 'internal'),
          sql`EXISTS (SELECT 1 FROM ${projectMembers}
                WHERE ${projectMembers.projectId} = ${projects.id}
                  AND ${projectMembers.userId} = ${q.visibleTo}
                  AND ${projectMembers.isDeleted} = false)`,
        )!,
      );
    }
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.updatedAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(projects)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Patch a project.
   *
   * Takes an executor so a handover can move `owner_user_id` and the two
   * membership rows that mirror it in one transaction — a partial handover
   * leaves the project owned by one user and the `owner` membership held by
   * another, and the access resolver honours both.
   */
  async update(
    id: string,
    patch: Partial<NewProjectRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<ProjectRow | null> {
    const rows = await executor
      .update(projects)
      .set(patch)
      .where(and(eq(projects.id, id), eq(projects.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(
    id: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(projects)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(projects.id, id));
  }

  /** Retire a project's memberships alongside it. */
  async softDeleteMembersForProject(
    projectId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(projectMembers)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.isDeleted, false),
        ),
      )
      .returning({ id: projectMembers.id });
    return rows.length;
  }

  /**
   * Allocate the next task number for a project.
   *
   * A counter incremented in place and returned, NOT `max(number) + 1`: two
   * concurrent creates both read the same maximum and then collide on
   * `tasks_number_idx`. `UPDATE ... RETURNING` serializes on the project row, so
   * the numbers are unique under any concurrency — and gapless, provided the
   * caller runs this in the same transaction as the insert, which is why the
   * executor parameter exists. See `TaskService.create`.
   *
   * `KEEP_UPDATED_AT` because this is bookkeeping, not an edit to the project.
   * Drizzle's `$onUpdate` would otherwise restamp `projects.updated_at` on
   * every task creation — and `list()` orders by that column, so adding a task
   * silently reordered the project list.
   */
  async allocateTaskNumber(
    projectId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(projects)
      .set({
        taskSeq: sql`${projects.taskSeq} + 1`,
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(eq(projects.id, projectId))
      .returning({ taskSeq: projects.taskSeq });
    if (!rows[0]) throw new Error(`Project ${projectId} not found`);
    return rows[0].taskSeq;
  }

  /** Recompute the denormalized completion percentage from task counts. */
  async refreshProgress(projectId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${projects} SET progress_pct = COALESCE((
        SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'done') / NULLIF(COUNT(*), 0))
        FROM tasks WHERE project_id = ${projectId} AND is_deleted = false
          AND status <> 'cancelled'
      ), 0) WHERE id = ${projectId}
    `);
  }

  // --- members ---

  /**
   * One user's memberships across a batch of projects, keyed by project id.
   *
   * The listing path resolves access per row, and calling `membership` inside
   * that loop issued one query per project on the page — up to 100 concurrent
   * single-row selects against a pool of 20 that is shared with the queue
   * workers and Mastra's store. One `inArray` instead, the same shape
   * `KnowledgeAclRepository.grantsForMany` already uses.
   */
  async membershipsForMany(
    projectIds: string[],
    userId: string,
  ): Promise<Map<string, ProjectMemberRow>> {
    const byProject = new Map<string, ProjectMemberRow>();
    if (projectIds.length === 0) return byProject;
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(
        and(
          inArray(projectMembers.projectId, projectIds),
          eq(projectMembers.userId, userId),
          eq(projectMembers.isDeleted, false),
        ),
      );
    for (const row of rows) byProject.set(row.projectId, row);
    return byProject;
  }

  async membership(
    projectId: string,
    userId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<ProjectMemberRow | null> {
    const rows = await executor
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listMembers(projectId: string): Promise<ProjectMemberRow[]> {
    return this.db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.isDeleted, false),
        ),
      )
      .orderBy(asc(projectMembers.joinedAt));
  }

  /** Member ids, for the search projection's scope array. */
  async memberUserIds(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.isDeleted, false),
        ),
      );
    return rows.map((r) => r.userId);
  }

  async upsertMember(
    projectId: string,
    userId: string,
    roleInProject: ProjectMemberRow['roleInProject'],
    addedBy: string | null,
    executor: DrizzleExecutor = this.db,
  ): Promise<ProjectMemberRow> {
    const existing = await this.membership(projectId, userId, executor);
    if (existing) {
      const rows = await executor
        .update(projectMembers)
        .set({ roleInProject })
        .where(eq(projectMembers.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await executor
      .insert(projectMembers)
      .values({ projectId, userId, roleInProject, addedBy })
      .returning();
    return rows[0];
  }

  /**
   * Step a member down to `roleInProject` if they currently hold a membership.
   *
   * The outgoing half of a handover. A no-op when the user has no row — an
   * owner recorded only on `projects.owner_user_id` has nothing to demote,
   * which is the normal case for a project created before membership existed.
   */
  async demoteMember(
    projectId: string,
    userId: string,
    roleInProject: ProjectMemberRow['roleInProject'],
    executor: DrizzleExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .update(projectMembers)
      .set({ roleInProject })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.isDeleted, false),
        ),
      )
      .returning({ id: projectMembers.id });
    return rows.length > 0;
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(projectMembers)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.isDeleted, false),
        ),
      )
      .returning({ id: projectMembers.id });
    return rows.length > 0;
  }

  // --- tags ---

  async tagIdsFor(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: projectTags.tagId })
      .from(projectTags)
      .where(
        and(
          eq(projectTags.projectId, projectId),
          eq(projectTags.isDeleted, false),
        ),
      );
    return rows.map((r) => r.tagId);
  }

  async setTags(
    projectId: string,
    tagIds: string[],
    taggedBy: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(projectTags)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(
          and(
            eq(projectTags.projectId, projectId),
            eq(projectTags.isDeleted, false),
            tagIds.length > 0
              ? notInArray(projectTags.tagId, tagIds)
              : sql`true`,
          ),
        );
      if (tagIds.length === 0) return;
      const existing = await tx
        .select({ tagId: projectTags.tagId })
        .from(projectTags)
        .where(
          and(
            eq(projectTags.projectId, projectId),
            eq(projectTags.isDeleted, false),
            inArray(projectTags.tagId, tagIds),
          ),
        );
      const held = new Set(existing.map((e) => e.tagId));
      const missing = tagIds.filter((id) => !held.has(id));
      if (missing.length > 0) {
        await tx
          .insert(projectTags)
          .values(missing.map((tagId) => ({ projectId, tagId, taggedBy })));
      }
    });
  }
}
