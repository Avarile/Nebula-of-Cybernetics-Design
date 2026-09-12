import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  getTableColumns,
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
import { taskProjectVisible } from './project-visibility.sql';
import {
  projects,
  taskDependencies,
  taskTags,
  taskWatchers,
  tasks,
  type NewTaskRow,
  type TaskDependencyRow,
  type TaskRow,
  type TaskWatcherRow,
} from '../../infrastructure/database/schema/project.schema';

/**
 * Assigns `updated_at` to itself, suppressing `baseColumns.updatedAt`'s
 * `$onUpdate` for writes that are not edits — the same guard `knowledge` and
 * `search_records` use. A rank rebalance must not restamp every task in a
 * column as modified.
 */
const KEEP_UPDATED_AT = sql`${tasks.updatedAt}`;

export interface TaskQuery {
  projectId?: string;
  status?: TaskRow['status'];
  assigneeUserId?: string;
  milestoneId?: string;
  search?: string;
  /**
   * Restrict to projects this user can see, as a SQL predicate.
   *
   * Replaces the old `projectIds?: string[]`, which the service filled by
   * listing one page of 500 project ids — silently dropping anything past the
   * window, and ordered by a column that churned on every task write.
   */
  visibleTo?: string;
  page: number;
  limit: number;
}

@Injectable()
export class TaskRepository extends BaseRepository<typeof tasks> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, tasks);
  }

  async findLiveById(id: string): Promise<TaskRow | null> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: TaskQuery): Promise<{ rows: TaskRow[]; total: number }> {
    const filters: SQL[] = [eq(tasks.isDeleted, false)];
    if (q.projectId) filters.push(eq(tasks.projectId, q.projectId));
    if (q.status) filters.push(eq(tasks.status, q.status));
    if (q.assigneeUserId)
      filters.push(eq(tasks.assigneeUserId, q.assigneeUserId));
    if (q.milestoneId) filters.push(eq(tasks.milestoneId, q.milestoneId));
    if (q.search) filters.push(ilike(tasks.title, `%${q.search}%`));
    // Always require a live project — an orphaned task must never be listed,
    // for any caller. When the caller is not privileged, the same subquery also
    // carries the readability clauses, so there is no ceiling on how many
    // projects they may see.
    filters.push(taskProjectVisible(tasks.projectId, q.visibleTo));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(tasks)
      .where(where)
      // Board order: the rank is what drag-and-drop writes, and NULLs (never
      // ranked) sort last so an unranked task does not jump to the top.
      .orderBy(asc(tasks.sortRank), asc(tasks.number))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(tasks)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** A board column in display order — what a rebalance rewrites. */
  async orderedForColumn(
    projectId: string,
    status: TaskRow['status'],
  ): Promise<Pick<TaskRow, 'id' | 'sortRank'>[]> {
    return this.db
      .select({ id: tasks.id, sortRank: tasks.sortRank })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
          eq(tasks.isDeleted, false),
        ),
      )
      .orderBy(asc(tasks.sortRank), asc(tasks.number));
  }

  /**
   * Rewrite ranks for a whole column in one transaction.
   *
   * All or nothing: a partial rewrite would interleave fresh short ranks with
   * stale long ones and reorder the board, which is worse than the overlong
   * ranks the rebalance exists to remove. `updatedAt` is held because a
   * rebalance is bookkeeping, not an edit to any of these tasks.
   */
  async setRanks(
    updates: { id: string; sortRank: string }[],
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    if (updates.length === 0) return;
    const run = async (tx: DrizzleExecutor) => {
      for (const { id, sortRank } of updates) {
        await tx
          .update(tasks)
          .set({ sortRank, updatedAt: KEEP_UPDATED_AT })
          .where(eq(tasks.id, id));
      }
    };
    if (executor === this.db) {
      await this.db.transaction(run);
      return;
    }
    await run(executor);
  }

  /** Neighbouring ranks in a board column, for computing a rank between them. */
  async ranksAround(
    projectId: string,
    status: TaskRow['status'],
  ): Promise<string[]> {
    const rows = await this.db
      .select({ rank: tasks.sortRank })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
          eq(tasks.isDeleted, false),
        ),
      )
      .orderBy(asc(tasks.sortRank));
    return rows.map((r) => r.rank).filter((r): r is string => r !== null);
  }

  /** Takes an executor so the insert can share a caller's transaction. */
  async create(
    values: NewTaskRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<TaskRow> {
    const rows = await executor.insert(tasks).values(values).returning();
    return rows[0];
  }

  /**
   * Allocate the project's next task number and insert the task, atomically, in
   * ONE statement.
   *
   * A data-modifying CTE rather than an explicit transaction. Both give gapless
   * numbering — a failed insert must not leave the counter advanced, or
   * `ACME-8` simply never exists — but `BEGIN`/`COMMIT` are two extra round
   * trips, and against a remote Postgres that measured at ~60 ms added to every
   * task creation. Postgres wraps a single statement in an implicit
   * transaction, so the CTE buys the same atomicity for free.
   *
   * The counter is incremented in place and returned, NOT `max(number) + 1`:
   * two concurrent creates would both read the same maximum and then collide on
   * `tasks_number_idx`. `UPDATE ... RETURNING` serializes on the project row.
   *
   * `updated_at` is assigned to itself for the reason `KEEP_UPDATED_AT`
   * documents: allocating a number is bookkeeping, and `ProjectRepository.list`
   * orders by that column, so bumping it here reorders the project list on
   * every task creation.
   */
  async createWithNumber(
    projectId: string,
    values: Omit<NewTaskRow, 'number'>,
  ): Promise<TaskRow> {
    const result = await this.db.execute(sql`
      WITH allocated AS (
        UPDATE ${projects}
           SET task_seq = task_seq + 1, updated_at = updated_at
         WHERE id = ${projectId}
        RETURNING task_seq
      )
      INSERT INTO ${tasks} (
        project_id, milestone_id, parent_task_id, number, title, description,
        status, priority, assignee_user_id, reporter_user_id, estimate_minutes,
        start_date, due_date, sort_rank
      )
      SELECT
        ${projectId}, ${values.milestoneId ?? null}, ${values.parentTaskId ?? null},
        allocated.task_seq, ${values.title}, ${values.description ?? null},
        ${values.status ?? 'todo'}, ${values.priority ?? 'medium'},
        ${values.assigneeUserId ?? null}, ${values.reporterUserId ?? null},
        ${values.estimateMinutes ?? null}, ${values.startDate ?? null},
        ${values.dueDate ?? null}, ${values.sortRank ?? null}
      FROM allocated
      RETURNING *
    `);
    const row = (result.rows as TaskRow[])[0];
    if (!row) throw new Error(`Project ${projectId} not found`);
    return this.hydrate(row);
  }

  /**
   * `db.execute` returns raw driver rows: snake_case keys and `date` columns as
   * strings. Re-read through the typed select so callers get a `TaskRow`.
   */
  private async hydrate(row: TaskRow | { id: string }): Promise<TaskRow> {
    const typed = await this.findLiveById(row.id);
    if (!typed) throw new Error(`Task ${row.id} vanished after insert`);
    return typed;
  }

  async update(
    id: string,
    patch: Partial<NewTaskRow>,
  ): Promise<TaskRow | null> {
    const rows = await this.db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, id), eq(tasks.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(
    id: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(tasks)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  /**
   * Retire every task under a project, returning the ids retired.
   *
   * One statement rather than a loop: the cascade has to be atomic with the
   * project's own delete, and a per-row loop inside a transaction would hold it
   * open for the length of the project. The returned ids are what the caller
   * hands to the index-removal job after the transaction commits.
   */
  async softDeleteForProject(
    projectId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<string[]> {
    const rows = await executor
      .update(tasks)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(and(eq(tasks.projectId, projectId), eq(tasks.isDeleted, false)))
      .returning({ id: tasks.id });
    return rows.map((r) => r.id);
  }

  /** Release every task pointing at a milestone that is going away. */
  async clearMilestone(
    milestoneId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(tasks)
      .set({ milestoneId: null })
      .where(
        and(eq(tasks.milestoneId, milestoneId), eq(tasks.isDeleted, false)),
      )
      .returning({ id: tasks.id });
    return rows.length;
  }

  /** Recompute logged minutes from the time entries that back them. */
  async refreshSpentMinutes(taskId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${tasks} SET spent_minutes = COALESCE((
        SELECT SUM(minutes) FROM time_entries
        WHERE task_id = ${taskId} AND is_deleted = false
      ), 0) WHERE id = ${taskId}
    `);
  }

  // --- dependencies ---

  async dependencies(taskId: string): Promise<TaskDependencyRow[]> {
    return this.db
      .select()
      .from(taskDependencies)
      .where(
        and(
          or(
            eq(taskDependencies.predecessorTaskId, taskId),
            eq(taskDependencies.successorTaskId, taskId),
          )!,
          eq(taskDependencies.isDeleted, false),
        ),
      );
  }

  /** Direct predecessors of a task — one step of the cycle walk. */
  async predecessorsOf(taskId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: taskDependencies.predecessorTaskId })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.successorTaskId, taskId),
          eq(taskDependencies.isDeleted, false),
        ),
      );
    return rows.map((r) => r.id);
  }

  async addDependency(
    predecessorTaskId: string,
    successorTaskId: string,
    type: TaskDependencyRow['type'],
    lagDays: number,
  ): Promise<TaskDependencyRow> {
    const rows = await this.db
      .insert(taskDependencies)
      .values({ predecessorTaskId, successorTaskId, type, lagDays })
      .returning();
    return rows[0];
  }

  /**
   * Remove a dependency edge that touches `taskId`.
   *
   * Scoped to the task the caller was authorized against, NOT to the edge id
   * alone. The route authorizes `taskId` and then deletes `id`; without this
   * predicate the two are unrelated, and a contributor on one project could
   * erase a scheduling constraint in any other project whose edge id they had
   * seen — `dependencies()` returns those ids in full to every viewer.
   *
   * Either direction matches, because `dependencies()` returns edges where the
   * task is predecessor or successor, so both are legitimately "this task's".
   */
  async removeDependency(id: string, taskId: string): Promise<boolean> {
    const rows = await this.db
      .update(taskDependencies)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(taskDependencies.id, id),
          eq(taskDependencies.isDeleted, false),
          or(
            eq(taskDependencies.successorTaskId, taskId),
            eq(taskDependencies.predecessorTaskId, taskId),
          )!,
        ),
      )
      .returning({ id: taskDependencies.id });
    return rows.length > 0;
  }

  /** Incomplete predecessors — what blocks a task from starting. */
  async unfinishedPredecessors(taskId: string): Promise<TaskRow[]> {
    return this.db
      .select(getTableColumns(tasks))
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.predecessorTaskId))
      .where(
        and(
          eq(taskDependencies.successorTaskId, taskId),
          eq(taskDependencies.isDeleted, false),
          eq(tasks.isDeleted, false),
          notInArray(tasks.status, ['done', 'cancelled']),
        ),
      );
  }

  // --- watchers ---

  async watchers(taskId: string): Promise<TaskWatcherRow[]> {
    return this.db
      .select()
      .from(taskWatchers)
      .where(
        and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.isDeleted, false)),
      );
  }

  /**
   * Add a watcher, ignoring a repeat.
   *
   * Called implicitly whenever someone is assigned, comments or is mentioned,
   * so it must be safe to call for someone already watching.
   */
  async watch(
    taskId: string,
    userId: string,
    reason: TaskWatcherRow['reason'],
  ): Promise<void> {
    const existing = await this.db
      .select({ id: taskWatchers.id })
      .from(taskWatchers)
      .where(
        and(
          eq(taskWatchers.taskId, taskId),
          eq(taskWatchers.userId, userId),
          eq(taskWatchers.isDeleted, false),
        ),
      )
      .limit(1);
    if (existing[0]) return;
    await this.db.insert(taskWatchers).values({ taskId, userId, reason });
  }

  async unwatch(taskId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(taskWatchers)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(taskWatchers.taskId, taskId),
          eq(taskWatchers.userId, userId),
          eq(taskWatchers.isDeleted, false),
        ),
      )
      .returning({ id: taskWatchers.id });
    return rows.length > 0;
  }

  // --- tags ---

  async tagIdsFor(taskId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: taskTags.tagId })
      .from(taskTags)
      .where(and(eq(taskTags.taskId, taskId), eq(taskTags.isDeleted, false)));
    return rows.map((r) => r.tagId);
  }

  async setTags(
    taskId: string,
    tagIds: string[],
    taggedBy: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(taskTags)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(
          and(
            eq(taskTags.taskId, taskId),
            eq(taskTags.isDeleted, false),
            tagIds.length > 0 ? notInArray(taskTags.tagId, tagIds) : sql`true`,
          ),
        );
      if (tagIds.length === 0) return;
      const existing = await tx
        .select({ tagId: taskTags.tagId })
        .from(taskTags)
        .where(
          and(
            eq(taskTags.taskId, taskId),
            eq(taskTags.isDeleted, false),
            inArray(taskTags.tagId, tagIds),
          ),
        );
      const held = new Set(existing.map((e) => e.tagId));
      const missing = tagIds.filter((id) => !held.has(id));
      if (missing.length > 0) {
        await tx
          .insert(taskTags)
          .values(missing.map((tagId) => ({ taskId, tagId, taggedBy })));
      }
    });
  }
}
