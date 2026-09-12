import { Inject, Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { TaskRow } from '../../infrastructure/database/schema/project.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import { TagService } from '../shared/tag.service';
import type {
  AddDependencyDto,
  CreateTaskDto,
  ListTasksDto,
  MoveTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { initialRank, rankBetween } from './lexorank.util';
import { PlanningRepository } from './planning.repository';
import { TaskBoardService } from './task-board.service';
import { ProjectProjectionService } from './project-projection.service';
import { ProjectRepository } from './project.repository';
import { ProjectService } from './project.service';
import { TaskRepository } from './task.repository';

/** Statuses that mean the work is over. */
const TERMINAL: TaskRow['status'][] = ['done', 'cancelled'];

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    // Number allocation and the insert have to land together — see `create`.
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: TaskRepository,
    private readonly projects: ProjectService,
    // The task-number counter lives on the project row, so allocating one is a
    // project write even though a task is what needs it.
    private readonly projectRepo: ProjectRepository,
    // Needed to check that a milestone belongs to the task's project.
    private readonly planning: PlanningRepository,
    // Board ordering — where a card sits within its column.
    private readonly board: TaskBoardService,
    private readonly projection: ProjectProjectionService,
    private readonly tags: TagService,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  private toDateString(d: Date | null | undefined): string | null | undefined {
    if (d === undefined) return undefined;
    return d === null ? null : d.toISOString().slice(0, 10);
  }

  async create(dto: CreateTaskDto, principal: Principal): Promise<TaskRow> {
    // Every task belongs to a project, and the project decides who may add one.
    await this.projects.require(dto.projectId, principal, 'contributor');
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'task');
    }

    await this.assertReferencesStayInProject(
      dto.projectId,
      null,
      dto.milestoneId,
      dto.parentTaskId,
    );

    const { tagIds, ...rest } = dto;
    const ranks = await this.repo.ranksAround(dto.projectId, dto.status);
    const sortRank =
      ranks.length > 0
        ? // New work lands at the bottom of its column.
          rankBetween(ranks[ranks.length - 1], null)
        : initialRank();

    // Number allocation and insert in ONE statement, so a failed insert cannot
    // leave the counter advanced and the number burned. The repository
    // documents the numbers as gapless; this is what makes that true.
    // (Uniqueness was never at risk — the counter serializes on the project
    // row either way.)
    const row = await this.repo.createWithNumber(dto.projectId, {
      ...rest,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
      reporterUserId: userIdOrNull(principal),
      sortRank,
    });

    if (tagIds?.length) {
      await this.repo.setTags(row.id, tagIds, userIdOrNull(principal));
    }
    await this.watchImplicitly(row, principal);
    await this.afterWrite(row.id, dto.projectId);
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: row.id,
      projectId: row.projectId,
      action: 'task.created',
      summary: row.title,
    });
    return row;
  }

  async list(dto: ListTasksDto, principal: Principal) {
    // A project filter is checked directly; without one, the query is narrowed
    // to the projects the caller can see, so a cross-project board cannot leak.
    if (dto.projectId) {
      await this.projects.require(dto.projectId, principal, 'viewer');
      const { rows, total } = await this.repo.list(dto);
      return { data: rows, total, page: dto.page, limit: dto.limit };
    }
    const { rows, total } = await this.repo.list({
      ...dto,
      visibleTo: this.projects.taskVisibilityScope(principal),
    });
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async get(id: string, principal: Principal): Promise<TaskRow> {
    const { task } = await this.require(id, principal, 'viewer');
    return task;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    principal: Principal,
  ): Promise<TaskRow> {
    const { task } = await this.require(id, principal, 'contributor');
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'task');
    }
    await this.assertReferencesStayInProject(
      task.projectId,
      id,
      dto.milestoneId,
    );

    const { tagIds, ...rest } = dto;
    const patch: Record<string, unknown> = {
      ...rest,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
    };
    await this.applyStatusChange(task, dto.status, patch, dto.blockedReason);

    const updated = await this.repo.update(id, patch);
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (tagIds) await this.repo.setTags(id, tagIds, userIdOrNull(principal));

    // Assignment implies watching: the notification layer reads watchers, and
    // an assignee who is not one would never hear about their own task.
    if (dto.assigneeUserId) {
      await this.repo.watch(id, dto.assigneeUserId, 'assigned');
    }
    await this.afterWrite(id, task.projectId);
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: id,
      projectId: task.projectId,
      action: dto.status ? 'task.status_changed' : 'task.updated',
      changes: dto.status
        ? { status: { from: task.status, to: dto.status } }
        : undefined,
    });
    return updated;
  }

  /**
   * The invariants every status transition must satisfy, and the timestamps it
   * implies — applied to `patch` in place.
   *
   * Extracted because `update()` enforced all of this and `move()` enforced
   * none of it, while both wrote `tasks.status`. Dragging a card to the Done
   * column is the ordinary way to finish work (it is what `cyb tasks mv
   * --status done` does), so the unguarded path was the common one: it
   * completed tasks with open predecessors, blocked them with no stated
   * blocker, and never stamped `completedAt`.
   *
   * One method owns status transitions now. A second copy of these rules is
   * how the first divergence happened.
   */
  private async applyStatusChange(
    task: TaskRow,
    next: TaskRow['status'] | undefined,
    patch: Record<string, unknown>,
    blockedReason?: string | null,
  ): Promise<void> {
    const nextStatus = next ?? task.status;

    if (nextStatus === 'blocked' && !(blockedReason ?? task.blockedReason)) {
      // A blocked task with no stated blocker is invisible work.
      throw this.errors.validation([
        {
          path: 'blockedReason',
          message: 'A blocked task must say what is blocking it',
        },
      ]);
    }

    if (next && next === 'done' && !TERMINAL.includes(task.status)) {
      const blockers = await this.repo.unfinishedPredecessors(task.id);
      if (blockers.length > 0) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message:
            `Cannot complete: ${blockers.length} predecessor task(s) are ` +
            `still open`,
        });
      }
    }

    if (!next) return;
    if (next === 'done' && task.status !== 'done') {
      patch.completedAt = new Date();
    }
    // Reopening has to clear the stamp, or the task reads as complete to
    // anything querying `completed_at IS NOT NULL` and cycle-time reporting
    // counts a completion that was undone.
    if (next !== 'done' && task.status === 'done') patch.completedAt = null;
    if (next !== 'blocked') patch.blockedReason = null;
  }

  /**
   * Move a task within or between board columns.
   *
   * Writes exactly one row: the new rank is computed between its neighbours,
   * which is the entire reason ranks are strings rather than integers. A status
   * change goes through the same guards `update()` applies.
   */
  async move(
    id: string,
    dto: MoveTaskDto,
    principal: Principal,
  ): Promise<TaskRow> {
    const { task } = await this.require(id, principal, 'contributor');
    const status = dto.status ?? task.status;
    const sortRank = await this.board.rankFor(task, status, dto.afterTaskId);

    const patch: Record<string, unknown> = { status, sortRank };
    await this.applyStatusChange(task, dto.status, patch);

    const updated = await this.repo.update(id, patch);
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    // Ranks lengthen by a character whenever two neighbours are adjacent, and
    // `sort_rank` is `varchar(64)`. Checked on the move that would otherwise
    // push the column past the threshold, so the cost lands on one drag in a
    // few hundred rather than on a sweep.
    await this.board.rebalanceIfNeeded(task.projectId, status);
    await this.afterWrite(id, task.projectId);
    return updated;
  }

  async remove(id: string, principal: Principal): Promise<void> {
    const { task } = await this.require(id, principal, 'contributor');
    await this.repo.softDelete(id);
    await this.cascade.purgeFor('task', id);
    await this.projection.removeTask(id);
    // (A second `projects.require` used to sit here, after the delete — the
    // same check `require` above already made, run too late to guard anything.)
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: id,
      projectId: task.projectId,
      action: 'task.deleted',
    });
  }

  // --- dependencies ---

  async dependencies(id: string, principal: Principal) {
    await this.require(id, principal, 'viewer');
    return this.repo.dependencies(id);
  }

  /**
   * Add a predecessor, refusing to create a cycle.
   *
   * The database check only catches a self-edge; a longer loop
   * (A -> B -> C -> A) needs a walk, done here before the insert. The graph is
   * project-local and small, so a breadth-first walk is cheap.
   */
  async addDependency(id: string, dto: AddDependencyDto, principal: Principal) {
    const { task } = await this.require(id, principal, 'contributor');
    if (dto.predecessorTaskId === id) {
      throw this.errors.validation([
        {
          path: 'predecessorTaskId',
          message: 'A task cannot depend on itself',
        },
      ]);
    }
    const predecessor = await this.repo.findLiveById(dto.predecessorTaskId);
    if (!predecessor || predecessor.projectId !== task.projectId) {
      throw this.errors.validation([
        {
          path: 'predecessorTaskId',
          message: 'Dependencies must stay within one project',
        },
      ]);
    }
    // The edge being added is `predecessor -> id`. It closes a loop precisely
    // when the predecessor ALREADY depends on `id`, so the walk has to start at
    // the predecessor and look for `id`. Starting at `id` instead asks whether
    // the edge is redundant, which is a different question with the same shape
    // — and answers "no" for every real cycle, letting A->B->A straight through.
    if (await this.reaches(dto.predecessorTaskId, id)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'That dependency would create a cycle',
      });
    }
    return this.repo.addDependency(
      dto.predecessorTaskId,
      id,
      dto.type,
      dto.lagDays,
    );
  }

  async removeDependency(
    id: string,
    dependencyId: string,
    principal: Principal,
  ): Promise<void> {
    await this.require(id, principal, 'contributor');
    // Scoped to the task just authorized: an edge id belonging to another
    // project must not be reachable through a task the caller happens to hold.
    const removed = await this.repo.removeDependency(dependencyId, id);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  /** Whether `from` already reaches `target` through predecessor edges. */
  private async reaches(from: string, target: string): Promise<boolean> {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === target && current !== from) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const predecessors = await this.repo.predecessorsOf(current);
      for (const p of predecessors) {
        if (p === target) return true;
        queue.push(p);
      }
    }
    return false;
  }

  // --- watchers ---

  async watchers(id: string, principal: Principal) {
    await this.require(id, principal, 'viewer');
    return this.repo.watchers(id);
  }

  async watch(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'viewer');
    await this.repo.watch(id, this.projects.requireUser(principal), 'manual');
  }

  async unwatch(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'viewer');
    await this.repo.unwatch(id, this.projects.requireUser(principal));
  }

  /** Load a task and check the caller's role on its project. */
  async require(
    id: string,
    principal: Principal,
    needed: 'viewer' | 'contributor' | 'manager' | 'owner',
  ): Promise<{ task: TaskRow }> {
    const task = await this.repo.findLiveById(id);
    if (!task) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projects.require(task.projectId, principal, needed);
    return { task };
  }

  /**
   * Reject a milestone or parent task that belongs to a different project.
   *
   * `addDependency` already refuses a cross-project predecessor and says why —
   * "Dependencies must stay within one project". The same reasoning was never
   * applied to these two, which were validated as UUIDs and written straight
   * through: a task could hang off a milestone in a project the caller could
   * not see, or off a parent in an already-deleted one. The write succeeding
   * also confirmed the id was real, which is a probe oracle on its own.
   */
  private async assertReferencesStayInProject(
    projectId: string,
    taskId: string | null,
    milestoneId?: string | null,
    parentTaskId?: string | null,
  ): Promise<void> {
    if (milestoneId) {
      const milestone = await this.planning.findMilestone(milestoneId);
      if (!milestone || milestone.projectId !== projectId) {
        throw this.errors.validation([
          {
            path: 'milestoneId',
            message: 'Milestones must belong to the same project',
          },
        ]);
      }
    }
    if (parentTaskId) {
      if (parentTaskId === taskId) {
        throw this.errors.validation([
          { path: 'parentTaskId', message: 'A task cannot be its own parent' },
        ]);
      }
      const parent = await this.repo.findLiveById(parentTaskId);
      if (!parent || parent.projectId !== projectId) {
        throw this.errors.validation([
          {
            path: 'parentTaskId',
            message: 'A parent task must be in the same project',
          },
        ]);
      }
      // Unlike `task_dependencies`, the subtask edge has no cycle guard at all
      // and `parent_task_id` cascades on delete, so a loop is unbounded
      // recursion for anything that walks the tree.
      if (taskId && (await this.parentReaches(parentTaskId, taskId))) {
        throw this.errors.validation([
          {
            path: 'parentTaskId',
            message: 'That parent would create a cycle',
          },
        ]);
      }
    }
  }

  /** Whether `from` already sits beneath `target` in the subtask tree. */
  private async parentReaches(from: string, target: string): Promise<boolean> {
    const seen = new Set<string>();
    let current: string | null = from;
    while (current && !seen.has(current)) {
      if (current === target) return true;
      seen.add(current);
      const row: TaskRow | null = await this.repo.findLiveById(current);
      current = row?.parentTaskId ?? null;
    }
    return false;
  }

  /** Whether a principal may read a task — the registry's resolver. */
  async canRead(id: string, principal: Principal): Promise<boolean> {
    const task = await this.repo.findLiveById(id);
    if (!task) return false;
    return this.projects.canRead(task.projectId, principal);
  }

  /** Everyone implicated in a task's creation starts watching it. */
  private async watchImplicitly(
    task: TaskRow,
    principal: Principal,
  ): Promise<void> {
    const reporter = userIdOrNull(principal);
    if (reporter) await this.repo.watch(task.id, reporter, 'reporter');
    if (task.assigneeUserId) {
      await this.repo.watch(task.id, task.assigneeUserId, 'assigned');
    }
  }

  /**
   * Denormalizations and the index, kept in step after every task write.
   *
   * Concurrent: the progress recount touches `projects`, the projection touches
   * `search_records`, and neither reads the other's output. Run in series this
   * was most of the ~90 ms a task write cost against ~30 ms for a read.
   */
  private async afterWrite(taskId: string, projectId: string): Promise<void> {
    await Promise.all([
      this.projects.repoRefreshProgress(projectId),
      this.projection.projectTask(taskId),
    ]);
  }
}
