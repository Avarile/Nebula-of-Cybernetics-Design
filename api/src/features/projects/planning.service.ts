import { Inject, Injectable } from '@nestjs/common';
import { isAdmin, userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  GoalRow,
  MilestoneRow,
} from '../../infrastructure/database/schema/project.schema';
import { ActivityService } from '../shared/activity.service';
import type {
  CreateGoalDto,
  CreateMilestoneDto,
  UpdateGoalDto,
  UpdateMilestoneDto,
} from './dto/planning.dto';
import { PlanningRepository } from './planning.repository';
import { ProjectService } from './project.service';
import { TaskRepository } from './task.repository';

@Injectable()
export class PlanningService {
  constructor(
    // Deleting a milestone must also release the tasks that reference it, and
    // the two writes have to land together.
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: PlanningRepository,
    private readonly projects: ProjectService,
    private readonly tasks: TaskRepository,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  private toDateString(d: Date | null | undefined): string | null | undefined {
    if (d === undefined) return undefined;
    return d === null ? null : d.toISOString().slice(0, 10);
  }

  // --- milestones ---

  async listMilestones(projectId: string, principal: Principal) {
    await this.projects.require(projectId, principal, 'viewer');
    return this.repo.listMilestones(projectId);
  }

  async createMilestone(
    projectId: string,
    dto: CreateMilestoneDto,
    principal: Principal,
  ): Promise<MilestoneRow> {
    await this.projects.require(projectId, principal, 'manager');
    const row = await this.repo.createMilestone({
      ...dto,
      projectId,
      dueDate: this.toDateString(dto.dueDate),
    });
    await this.activity.recordSafe({
      principal,
      entityType: 'milestone',
      entityId: row.id,
      projectId,
      action: 'milestone.created',
      summary: row.name,
    });
    return row;
  }

  async updateMilestone(
    id: string,
    dto: UpdateMilestoneDto,
    principal: Principal,
  ): Promise<MilestoneRow> {
    const existing = await this.requireMilestone(id, principal, 'manager');
    const patch: Record<string, unknown> = {
      ...dto,
      dueDate: this.toDateString(dto.dueDate),
    };
    // `reached_at` is the event instant; setting it here keeps it consistent
    // with the status rather than leaving two fields to disagree.
    if (dto.status === 'reached' && existing.status !== 'reached') {
      patch.reachedAt = new Date();
    }
    if (dto.status && dto.status !== 'reached') patch.reachedAt = null;

    const row = await this.repo.updateMilestone(id, patch);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.activity.recordSafe({
      principal,
      entityType: 'milestone',
      entityId: id,
      projectId: existing.projectId,
      action: 'milestone.updated',
      changes: dto.status
        ? { status: { from: existing.status, to: dto.status } }
        : undefined,
    });
    return row;
  }

  /**
   * Soft-delete a milestone and release the tasks pointing at it.
   *
   * One transaction, because a task whose `milestone_id` survives the milestone
   * references a row nothing can reach: the milestone list no longer shows it,
   * but `GET /tasks?milestoneId=<dead>` still returns the task, and the UI
   * renders an assignment to a milestone that does not exist.
   *
   * Clearing rather than refusing: unlike `removeGoal`, where a key result is
   * meaningless without its objective, a task is perfectly coherent with no
   * milestone at all.
   */
  async removeMilestone(id: string, principal: Principal): Promise<void> {
    await this.requireMilestone(id, principal, 'manager');
    await this.db.transaction(async (tx) => {
      await this.repo.softDeleteMilestone(id, tx);
      await this.tasks.clearMilestone(id, tx);
    });
  }

  // --- access, for the entity registry ---

  /** Whether a principal may read a milestone — its project decides. */
  async canReadMilestone(id: string, principal: Principal): Promise<boolean> {
    const row = await this.repo.findMilestone(id);
    if (!row) return false;
    return this.projects.canRead(row.projectId, principal);
  }

  /**
   * Whether a principal may read a goal.
   *
   * A project goal inherits its project. An organizational goal belongs to no
   * project, so there is no membership to consult and it stays admin-only —
   * the same rule `requireGoal` applies to writes.
   */
  async canReadGoal(id: string, principal: Principal): Promise<boolean> {
    const row = await this.repo.findGoal(id);
    if (!row) return false;
    if (!row.projectId)
      return principal.kind === 'system' || isAdmin(principal);
    return this.projects.canRead(row.projectId, principal);
  }

  private async requireMilestone(
    id: string,
    principal: Principal,
    needed: 'viewer' | 'manager',
  ): Promise<MilestoneRow> {
    const row = await this.repo.findMilestone(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projects.require(row.projectId, principal, needed);
    return row;
  }

  // --- goals ---

  /**
   * Goals for a project, plus organizational ones.
   *
   * Organizational goals (`project_id IS NULL`) are readable by any
   * authenticated caller: they describe the company, not a project, and hiding
   * them behind project membership would make them invisible everywhere.
   */
  async listGoals(projectId: string | null, principal: Principal) {
    if (projectId) await this.projects.require(projectId, principal, 'viewer');
    return this.repo.listGoals(projectId);
  }

  async createGoal(
    dto: CreateGoalDto,
    projectId: string | null,
    principal: Principal,
  ): Promise<GoalRow> {
    if (projectId) await this.projects.require(projectId, principal, 'manager');
    if (dto.parentGoalId) {
      const parent = await this.repo.findGoal(dto.parentGoalId);
      if (!parent) {
        throw this.errors.validation([
          { path: 'parentGoalId', message: 'Unknown objective' },
        ]);
      }
      if (parent.kind !== 'objective') {
        throw this.errors.validation([
          {
            path: 'parentGoalId',
            message: 'Key results hang off objectives, not other key results',
          },
        ]);
      }
    }
    const row = await this.repo.createGoal({
      ...dto,
      projectId,
      ownerUserId: dto.ownerUserId ?? userIdOrNull(principal),
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
      progressPct: this.progressOf(
        dto.currentValue,
        dto.targetValue,
        dto.direction,
      ),
    });
    await this.activity.recordSafe({
      principal,
      entityType: 'goal',
      entityId: row.id,
      projectId: projectId ?? undefined,
      action: 'goal.created',
      summary: row.title,
    });
    return row;
  }

  async updateGoal(
    id: string,
    dto: UpdateGoalDto,
    principal: Principal,
  ): Promise<GoalRow> {
    const existing = await this.requireGoal(id, principal, 'manager');
    const currentValue = dto.currentValue ?? existing.currentValue;
    const targetValue = dto.targetValue ?? existing.targetValue;
    const direction = dto.direction ?? existing.direction;

    const row = await this.repo.updateGoal(id, {
      ...dto,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
      progressPct: this.progressOf(currentValue, targetValue, direction),
      ...(dto.status === 'achieved' && existing.status !== 'achieved'
        ? { achievedAt: new Date() }
        : {}),
      // Clear it on the way back out, as `updateMilestone` does for `reachedAt`.
      ...(dto.status &&
      dto.status !== 'achieved' &&
      existing.status === 'achieved'
        ? { achievedAt: null }
        : {}),
    });
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async removeGoal(id: string, principal: Principal): Promise<void> {
    await this.requireGoal(id, principal, 'manager');
    const children = await this.repo.keyResults(id);
    if (children.length > 0) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Objective has ${children.length} key result(s); remove them first`,
      });
    }
    await this.repo.softDeleteGoal(id);
  }

  private async requireGoal(
    id: string,
    principal: Principal,
    needed: 'viewer' | 'manager',
  ): Promise<GoalRow> {
    const row = await this.repo.findGoal(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (row.projectId) {
      await this.projects.require(row.projectId, principal, needed);
    } else if (needed !== 'viewer' && principal.kind !== 'system') {
      // An organizational goal belongs to no project, so there is no membership
      // to check; changing one is an administrative act.
      if (!(principal.kind === 'user' && principal.role === 'admin')) {
        throw this.errors.create(ErrorCode.FORBIDDEN, {
          message: 'Only an admin can change an organizational goal',
        });
      }
    }
    return row;
  }

  /**
   * Progress towards a target, as a percentage.
   *
   * Direction-aware: for a `decrease` goal (cut churn to 2%), being under the
   * target is success, and treating it as `current / target` would report 200%.
   */
  private progressOf(
    current: string | null | undefined,
    target: string | null | undefined,
    direction: GoalRow['direction'] | null | undefined,
  ): number {
    const c = Number(current);
    const t = Number(target);
    if (!Number.isFinite(c) || !Number.isFinite(t) || t === 0) return 0;
    const ratio =
      direction === 'decrease' ? (t === 0 ? 0 : t / Math.max(c, 1e-9)) : c / t;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }
}
