import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  isAdmin,
  requireUserId,
  userIdOrNull,
  type Principal,
} from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  ProjectMemberRow,
  ProjectRow,
} from '../../infrastructure/database/schema/project.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import { TagService } from '../shared/tag.service';
import type {
  AddMemberDto,
  CreateProjectDto,
  ListProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { PlanningRepository } from './planning.repository';
import { ProjectLinkRepository } from './project-link.repository';
import {
  toDateString,
  toPublicProject,
  type PublicProject,
} from './project.mapper';
import { ProjectProjectionService } from './project-projection.service';
import {
  permitsProject,
  resolveProjectAccess,
  type ProjectAccess,
  type ProjectRole,
} from './project-scope.resolver';
import { ProjectRepository } from './project.repository';
import { TaskRepository } from './task.repository';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    // Injected directly so a handover can open its own transaction: the owner
    // column and the membership rows that mirror it must move together.
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: ProjectRepository,
    // The child tables a project delete has to reach. Injected as repositories
    // rather than services to keep the cascade one transaction deep — the
    // services would each open their own.
    private readonly tasks: TaskRepository,
    private readonly planning: PlanningRepository,
    private readonly links: ProjectLinkRepository,
    private readonly projection: ProjectProjectionService,
    private readonly tags: TagService,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  async create(
    dto: CreateProjectDto,
    principal: Principal,
  ): Promise<PublicProject> {
    if (await this.repo.findByKey(dto.key)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Project key "${dto.key}" is already in use`,
      });
    }
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'project');
    }
    await this.assertParentIsUsable(null, dto.parentProjectId, principal);
    const { tagIds, ...rest } = dto;
    const ownerUserId = userIdOrNull(principal);
    const row = await this.repo.create({
      ...rest,
      startDate: toDateString(dto.startDate),
      dueDate: toDateString(dto.dueDate),
      // Nullable only because an agent may create autonomously (Q7); a project
      // with no owner is surfaced for claiming by `projects_unowned_idx`.
      ownerUserId,
    });
    if (ownerUserId) {
      // The creator is a member in their own right, so membership queries do not
      // have to special-case ownership.
      await this.repo.upsertMember(row.id, ownerUserId, 'owner', ownerUserId);
    }
    if (tagIds?.length) {
      await this.repo.setTags(row.id, tagIds, ownerUserId);
    }
    await this.projection.projectProject(row.id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: row.id,
      projectId: row.id,
      action: 'project.created',
      summary: `${row.key} — ${row.name}`,
    });
    return toPublicProject(row, 'owner', tagIds ?? []);
  }

  async list(dto: ListProjectsDto, principal: Principal) {
    const visibleTo =
      isAdmin(principal) || principal.kind === 'system'
        ? undefined
        : principal.kind === 'user'
          ? principal.userId
          : // A service credential owns and belongs to nothing; it sees the
            // `internal` projects the SQL predicate also matches.
            '00000000-0000-0000-0000-000000000000';
    const { rows, total } = await this.repo.list({ ...dto, visibleTo });

    // Memberships for the whole page in one query, then resolve per row in
    // memory. `accessFor` returns early for admins and the system principal, so
    // the per-row lookup it would otherwise do was invisible in admin testing
    // and only cost an ordinary user one query per project on the page.
    const memberships: Map<string, ProjectMemberRow> =
      principal.kind === 'user' && !isAdmin(principal)
        ? await this.repo.membershipsForMany(
            rows.map((r) => r.id),
            principal.userId,
          )
        : new Map();

    const enriched = rows.map((row) => ({
      row,
      access:
        isAdmin(principal) || principal.kind === 'system'
          ? ('owner' as const)
          : resolveProjectAccess(
              row,
              principal,
              memberships.get(row.id) ?? null,
            ),
    }));
    return {
      data: enriched.map((e) => toPublicProject(e.row, e.access)),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async get(id: string, principal: Principal): Promise<PublicProject> {
    const { row, access } = await this.require(id, principal, 'viewer');
    const tagIds = await this.repo.tagIdsFor(id);
    return toPublicProject(row, access, tagIds);
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    principal: Principal,
  ): Promise<PublicProject> {
    const { row, access } = await this.require(id, principal, 'manager');
    if (dto.ownerUserId !== undefined && access !== 'owner') {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Only the project owner or an admin can hand it over',
      });
    }
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'project');
    }
    await this.assertParentIsUsable(id, dto.parentProjectId, principal);
    const { tagIds, ...rest } = dto;
    const patch: Record<string, unknown> = {
      ...rest,
      startDate: toDateString(dto.startDate),
      dueDate: toDateString(dto.dueDate),
    };
    // Stamp on the way in, clear on the way out. Leaving the stamp behind makes
    // a reopened project read as complete to anything querying
    // `completed_at IS NOT NULL` — the mistake `updateMilestone` avoids by
    // nulling `reachedAt` on the reverse transition.
    if (dto.status === 'completed' && row.status !== 'completed') {
      patch.completedAt = new Date();
    }
    if (
      dto.status &&
      dto.status !== 'completed' &&
      row.status === 'completed'
    ) {
      patch.completedAt = null;
    }
    if (dto.status === 'archived' && row.status !== 'archived') {
      patch.archivedAt = new Date();
    }
    if (dto.status && dto.status !== 'archived' && row.status === 'archived') {
      patch.archivedAt = null;
    }

    const updated =
      dto.ownerUserId !== undefined && dto.ownerUserId !== row.ownerUserId
        ? await this.handOver(
            id,
            patch,
            row.ownerUserId,
            dto.ownerUserId,
            userIdOrNull(principal),
          )
        : await this.repo.update(id, patch);
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (tagIds) await this.repo.setTags(id, tagIds, userIdOrNull(principal));
    // Ownership and visibility both change who can read it — and that scope
    // lives on every task too, so the fan-out goes to the queue.
    await this.projection.enqueueReprojection(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.updated',
    });
    return toPublicProject(updated, access, tagIds ?? []);
  }

  /**
   * Move ownership, and the membership row that mirrors it, in one transaction.
   *
   * `resolveProjectAccess` grants `owner` from EITHER `projects.owner_user_id`
   * OR an `owner` membership row. Writing only the column left the outgoing
   * owner holding the row — so a handover transferred the title without
   * revoking anything, and the incoming owner got no membership at all, which
   * hid them from the member list and from `removeMember`'s guard.
   *
   * The outgoing owner is demoted to `manager` rather than removed: they were
   * running the project a moment ago, and dropping them to no access at all is
   * a bigger step than a handover implies. An explicit `removeMember` still
   * takes them off entirely.
   */
  private async handOver(
    id: string,
    patch: Record<string, unknown>,
    from: string | null,
    to: string | null,
    actorUserId: string | null,
  ): Promise<ProjectRow | null> {
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.update(id, patch, tx);
      if (!updated) return null;
      if (from) await this.repo.demoteMember(id, from, 'manager', tx);
      if (to) await this.repo.upsertMember(id, to, 'owner', actorUserId, tx);
      return updated;
    });
  }

  /**
   * Soft-delete a project and everything that hangs off it.
   *
   * The delete used to stop at the project row. Its tasks stayed
   * `is_deleted = false` forever — unreadable, because every task route
   * authorizes through the parent and the parent was gone, but still returned
   * by the unfiltered task list and still holding their search documents. And
   * because `DELETE /tasks/:id` authorizes the same way, no API route could
   * reach them: they were simultaneously live and unreachable, with only direct
   * SQL able to retire them.
   *
   * One `UPDATE` per child table, all in one transaction — not a per-row loop,
   * which would hold the transaction open for the size of the project. Index
   * removal happens after the commit: search is eventually consistent by
   * design, and a Meili round trip has no business inside a database
   * transaction.
   */
  async remove(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'owner');
    const taskIds = await this.db.transaction(async (tx) => {
      const ids = await this.tasks.softDeleteForProject(id, tx);
      await this.planning.softDeleteMilestonesForProject(id, tx);
      await this.planning.softDeleteGoalsForProject(id, tx);
      await this.links.softDeleteLinksForProject(id, tx);
      await this.links.softDeleteTimeEntriesForProject(id, tx);
      await this.repo.softDeleteMembersForProject(id, tx);
      await this.cascade.purgeFor('project', id, tx);
      await this.repo.softDelete(id, tx);
      return ids;
    });
    await this.projection.enqueueDeprojection(id, taskIds);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.deleted',
    });
  }

  // --- members ---

  async listMembers(id: string, principal: Principal) {
    await this.require(id, principal, 'viewer');
    return this.repo.listMembers(id);
  }

  async addMember(
    id: string,
    dto: AddMemberDto,
    principal: Principal,
  ): Promise<void> {
    await this.require(id, principal, 'manager');
    await this.repo.upsertMember(
      id,
      dto.userId,
      dto.roleInProject,
      userIdOrNull(principal),
    );
    // Membership is the scope array for the project AND every task in it, so
    // this is linear in the project's size. The project's own document is
    // refreshed inline; the tasks converge behind the queue.
    await this.projection.enqueueReprojection(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.member_added',
      summary: dto.roleInProject,
    });
  }

  async removeMember(
    id: string,
    userId: string,
    principal: Principal,
  ): Promise<void> {
    const { row } = await this.require(id, principal, 'manager');
    if (row.ownerUserId === userId) {
      // Removing the owner's membership would not remove their ownership, so
      // the row and the policy would disagree.
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'Transfer ownership before removing the owner',
      });
    }
    const removed = await this.repo.removeMember(id, userId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projection.enqueueReprojection(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.member_removed',
    });
  }

  // --- access ---

  /** Whether a principal may read a project — the registry's resolver. */
  async canRead(id: string, principal: Principal): Promise<boolean> {
    const row = await this.repo.findLiveById(id);
    if (!row) return false;
    return (await this.accessFor(row, principal)) !== 'none';
  }

  /**
   * The user id a cross-project task list should be scoped to, or `undefined`
   * for a caller that may see everything.
   *
   * Returns an id rather than a list of project ids on purpose. The previous
   * version materialized the caller's projects — one page, `limit: 500`, no
   * continuation — and handed them down as an `IN` list, so a caller past 500
   * visible projects silently lost the tasks of everything outside the window,
   * with a `total` computed over the narrowed set so the page and the count
   * agreed with each other while both were wrong. The window was ordered by
   * `updated_at`, which task creation used to churn, so the omission was not
   * even stable between two calls a minute apart.
   *
   * `internal` visibility makes a project readable by every user, so 500 was an
   * installation-wide ceiling, not a per-user one. The predicate now lives in
   * SQL (`taskProjectVisible`) and has no ceiling at all.
   *
   * A service credential gets the same all-zero sentinel `list()` uses: it owns
   * and belongs to nothing, so only `internal` projects match.
   */
  taskVisibilityScope(principal: Principal): string | undefined {
    if (isAdmin(principal) || principal.kind === 'system') return undefined;
    if (principal.kind === 'user') return principal.userId;
    return '00000000-0000-0000-0000-000000000000';
  }

  /**
   * Load a project and assert the caller holds at least `needed`.
   *
   * Everything beneath a project routes through here, which is what keeps the
   * module to one authorization path.
   */
  async require(
    id: string,
    principal: Principal,
    needed: ProjectRole,
  ): Promise<{ row: ProjectRow; access: ProjectAccess }> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    const access = await this.accessFor(row, principal);
    // A caller who cannot see the project must not learn it exists.
    if (access === 'none') throw this.errors.create(ErrorCode.NOT_FOUND);
    if (!permitsProject(access, needed)) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `This action requires the "${needed}" role on the project`,
      });
    }
    return { row, access };
  }

  private async accessFor(
    row: ProjectRow,
    principal: Principal,
  ): Promise<ProjectAccess> {
    if (isAdmin(principal) || principal.kind === 'system') return 'owner';
    const membership =
      principal.kind === 'user'
        ? await this.repo.membership(row.id, principal.userId)
        : null;
    return resolveProjectAccess(row, principal, membership);
  }

  /**
   * Reject a parent project that is missing, unreadable, or would close a loop.
   *
   * `parentProjectId` was accepted as a bare UUID: a project could be its own
   * parent, or point at a soft-deleted one, or at a project the caller cannot
   * see. Nothing reads the hierarchy today, so the effect is latent — but a
   * recursive walk over a self-parented row does not terminate, and that walk
   * is the obvious next feature.
   */
  private async assertParentIsUsable(
    childId: string | null,
    parentProjectId: string | null | undefined,
    principal: Principal,
  ): Promise<void> {
    if (!parentProjectId) return;
    if (parentProjectId === childId) {
      throw this.errors.validation([
        {
          path: 'parentProjectId',
          message: 'A project cannot be its own parent',
        },
      ]);
    }
    // Readable, not merely extant: naming an invisible project as a parent
    // would confirm its id exists.
    if (!(await this.canRead(parentProjectId, principal))) {
      throw this.errors.validation([
        { path: 'parentProjectId', message: 'Unknown parent project' },
      ]);
    }
    if (!childId) return;
    const seen = new Set<string>();
    let current: string | null = parentProjectId;
    while (current && !seen.has(current)) {
      if (current === childId) {
        throw this.errors.validation([
          {
            path: 'parentProjectId',
            message: 'That parent would create a cycle',
          },
        ]);
      }
      seen.add(current);
      const row: ProjectRow | null = await this.repo.findLiveById(current);
      current = row?.parentProjectId ?? null;
    }
  }

  /** The caller's own id, for routes that are meaningless without one. */
  requireUser(principal: Principal): string {
    return requireUserId(principal);
  }

  /**
   * Recompute a project's completion percentage.
   *
   * Exposed for `TaskService`, which must refresh it after every task write.
   * Routed through the service rather than by sharing the repository, so the
   * denormalization has exactly one owner.
   */
  async repoRefreshProgress(projectId: string): Promise<void> {
    await this.repo.refreshProgress(projectId);
  }
}
