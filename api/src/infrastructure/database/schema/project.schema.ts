import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { users } from './identity.schema';
import { tags } from './shared.schema';

/** Project lifecycle. Deletion stays orthogonal (soft-delete columns). */
export const projectStatus = pgEnum('project_status', [
  'draft',
  'active',
  'on_hold',
  'completed',
  'archived',
  'cancelled',
]);

/**
 * One priority vocabulary shared by projects, tasks and notifications. Three
 * parallel enums with the same four values would drift and force translation at
 * every boundary.
 */
export const priorityLevel = pgEnum('priority_level', [
  'low',
  'medium',
  'high',
  'urgent',
]);

/**
 * Who may read a project at all. `private` is the default for the same reason
 * `collections.visibility` defaults to private: a resource that forgets to
 * declare a policy must be invisible, not public.
 */
export const projectVisibility = pgEnum('project_visibility', [
  'private',
  'internal',
]);

/** Ordered: `owner` implies every capability below it. */
export const projectMemberRole = pgEnum('project_member_role', [
  'owner',
  'manager',
  'contributor',
  'viewer',
]);

export const milestoneStatus = pgEnum('milestone_status', [
  'pending',
  'in_progress',
  'reached',
  'missed',
  'cancelled',
]);

export const taskStatus = pgEnum('task_status', [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
]);

export const dependencyType = pgEnum('dependency_type', [
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
  'start_to_finish',
]);

/** Why someone watches a task — lets a notification explain itself. */
export const watchReason = pgEnum('watch_reason', [
  'manual',
  'assigned',
  'commented',
  'mentioned',
  'reporter',
]);

export const goalKind = pgEnum('goal_kind', ['objective', 'key_result']);

export const goalStatus = pgEnum('goal_status', [
  'draft',
  'active',
  'at_risk',
  'achieved',
  'missed',
  'cancelled',
]);

/** Without a direction, "current 40 against target 30" is unreadable. */
export const goalDirection = pgEnum('goal_direction', [
  'increase',
  'decrease',
  'maintain',
]);

/**
 * A project. `project_members` (below) is the row-level authorization table for
 * everything beneath it: tasks, milestones, goals, comments, attachments and
 * time entries all inherit a project's scope rather than carrying their own ACL.
 */
export const projects = pgTable(
  'projects',
  {
    ...baseColumns,
    /** Short human code (`ACME`), prefixing task numbers. */
    key: varchar('key', { length: 20 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: projectStatus('status').notNull().default('draft'),
    priority: priorityLevel('priority').notNull().default('medium'),
    /**
     * Accountable human owner. Nullable ONLY because agents may create projects
     * autonomously (a scheduled run has no triggering user); such a project is
     * unowned and surfaced in an admin claim queue by `projects_unowned_idx`.
     * Every user-initiated path populates it via `requireUserId`.
     */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    leadUserId: uuid('lead_user_id').references(() => users.id),
    parentProjectId: uuid('parent_project_id').references(
      (): AnyPgColumn => projects.id,
    ),
    visibility: projectVisibility('visibility').notNull().default('private'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /**
     * Denormalized 0-100, recomputed from task completion on task write.
     * Display only, never a source of truth, rebuildable by a sweep.
     */
    progressPct: integer('progress_pct').notNull().default(0),
    /**
     * Allocates `tasks.number`. A counter incremented inside the insert
     * transaction, not `max(number) + 1`, which races under concurrent creates.
     */
    taskSeq: integer('task_seq').notNull().default(0),
    budgetAmount: numeric('budget_amount', { precision: 20, scale: 4 }),
    currency: varchar('currency', { length: 3 }),
    color: varchar('color', { length: 16 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('projects_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('projects_status_idx')
      .on(t.status)
      .where(sql`${t.isDeleted} = false`),
    index('projects_owner_idx').on(t.ownerUserId),
    index('projects_parent_idx').on(t.parentProjectId),
    index('projects_due_idx')
      .on(t.dueDate)
      .where(sql`${t.status} = 'active'`),
    index('projects_unowned_idx')
      .on(t.createdAt)
      .where(sql`${t.ownerUserId} IS NULL AND ${t.isDeleted} = false`),
  ],
);

/** Row-level membership. `project_members_user_idx` serves "my projects". */
export const projectMembers = pgTable(
  'project_members',
  {
    ...baseColumns,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleInProject: projectMemberRole('role_in_project')
      .notNull()
      .default('contributor'),
    addedBy: uuid('added_by').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('project_members_pair_idx')
      .on(t.projectId, t.userId)
      .where(sql`${t.isDeleted} = false`),
    index('project_members_user_idx').on(t.userId),
  ],
);

export const milestones = pgTable(
  'milestones',
  {
    ...baseColumns,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: milestoneStatus('status').notNull().default('pending'),
    dueDate: date('due_date'),
    reachedAt: timestamp('reached_at', { withTimezone: true }),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('milestones_project_idx').on(t.projectId, t.sortOrder),
    index('milestones_due_idx')
      .on(t.dueDate)
      .where(sql`${t.status} <> 'reached'`),
  ],
);

/**
 * A task. `project_id` is required: a project-less task has no membership to
 * inherit, so it would need its own ACL and the module would grow a second
 * authorization path for a minority of rows.
 */
export const tasks = pgTable(
  'tasks',
  {
    ...baseColumns,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => milestones.id),
    parentTaskId: uuid('parent_task_id').references(
      (): AnyPgColumn => tasks.id,
      { onDelete: 'cascade' },
    ),
    /** Per-project sequence rendered as `ACME-42`; see `projects.taskSeq`. */
    number: integer('number').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('todo'),
    priority: priorityLevel('priority').notNull().default('medium'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    /** Null for agent-created tasks (`userIdOrNull`). */
    reporterUserId: uuid('reporter_user_id').references(() => users.id),
    estimateMinutes: integer('estimate_minutes'),
    /** Denormalized from `time_entries`; rebuildable by a sweep. */
    spentMinutes: integer('spent_minutes').notNull().default(0),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Required by the service when `status = 'blocked'` — a blocked task with
     * no stated blocker is invisible work. */
    blockedReason: varchar('blocked_reason', { length: 500 }),
    /**
     * Lexicographic rank for drag-and-drop ordering within a board column. A
     * move writes exactly one row; an integer `sort_order` would rewrite the
     * whole list on every move.
     */
    sortRank: varchar('sort_rank', { length: 64 }),
    externalRef: varchar('external_ref', { length: 255 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('tasks_number_idx')
      .on(t.projectId, t.number)
      .where(sql`${t.isDeleted} = false`),
    index('tasks_project_status_idx').on(t.projectId, t.status),
    index('tasks_assignee_idx').on(t.assigneeUserId, t.status),
    index('tasks_milestone_idx').on(t.milestoneId),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_due_idx')
      .on(t.dueDate)
      .where(sql`${t.status} NOT IN ('done', 'cancelled')`),
    index('tasks_board_idx').on(t.projectId, t.status, t.sortRank),
  ],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    ...baseColumns,
    predecessorTaskId: uuid('predecessor_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    successorTaskId: uuid('successor_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    type: dependencyType('type').notNull().default('finish_to_start'),
    lagDays: integer('lag_days').notNull().default(0),
  },
  (t) => [
    uniqueIndex('task_dependencies_pair_idx')
      .on(t.predecessorTaskId, t.successorTaskId)
      .where(sql`${t.isDeleted} = false`),
    index('task_dependencies_successor_idx').on(t.successorTaskId),
    /** Longer cycles are rejected by a service-side walk; this is the trivial one. */
    check(
      'task_dependencies_no_self_ck',
      sql`${t.predecessorTaskId} <> ${t.successorTaskId}`,
    ),
  ],
);

/** The recipient set for task notifications — a table, not a union computed at send time. */
export const taskWatchers = pgTable(
  'task_watchers',
  {
    ...baseColumns,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: watchReason('reason').notNull().default('manual'),
  },
  (t) => [
    uniqueIndex('task_watchers_pair_idx')
      .on(t.taskId, t.userId)
      .where(sql`${t.isDeleted} = false`),
    index('task_watchers_user_idx').on(t.userId),
  ],
);

/**
 * Objectives and their key results in one self-referencing table. A `key_result`
 * must have a parent objective and an `objective` must not — enforced in the
 * service, where the message can explain itself.
 */
export const goals = pgTable(
  'goals',
  {
    ...baseColumns,
    /** Null for organizational goals that sit above any single project. */
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    parentGoalId: uuid('parent_goal_id').references(
      (): AnyPgColumn => goals.id,
      { onDelete: 'cascade' },
    ),
    kind: goalKind('kind').notNull().default('objective'),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    status: goalStatus('status').notNull().default('active'),
    metricName: varchar('metric_name', { length: 120 }),
    targetValue: numeric('target_value', { precision: 20, scale: 4 }),
    currentValue: numeric('current_value', { precision: 20, scale: 4 }),
    unit: varchar('unit', { length: 40 }),
    direction: goalDirection('direction'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    achievedAt: timestamp('achieved_at', { withTimezone: true }),
    progressPct: integer('progress_pct').notNull().default(0),
  },
  (t) => [
    index('goals_project_idx').on(t.projectId),
    index('goals_parent_idx').on(t.parentGoalId),
    index('goals_owner_status_idx').on(t.ownerUserId, t.status),
  ],
);

/** Join to the shared tag vocabulary (see `shared.schema.ts`). */
export const projectTags = pgTable(
  'project_tags',
  {
    ...baseColumns,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    taggedBy: uuid('tagged_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('project_tags_pair_idx')
      .on(t.projectId, t.tagId)
      .where(sql`${t.isDeleted} = false`),
    index('project_tags_tag_idx').on(t.tagId),
  ],
);

export const taskTags = pgTable(
  'task_tags',
  {
    ...baseColumns,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    taggedBy: uuid('tagged_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('task_tags_pair_idx')
      .on(t.taskId, t.tagId)
      .where(sql`${t.isDeleted} = false`),
    index('task_tags_tag_idx').on(t.tagId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type NewProjectMemberRow = typeof projectMembers.$inferInsert;
export type MilestoneRow = typeof milestones.$inferSelect;
export type NewMilestoneRow = typeof milestones.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type NewTaskDependencyRow = typeof taskDependencies.$inferInsert;
export type TaskWatcherRow = typeof taskWatchers.$inferSelect;
export type NewTaskWatcherRow = typeof taskWatchers.$inferInsert;
export type GoalRow = typeof goals.$inferSelect;
export type NewGoalRow = typeof goals.$inferInsert;
export type ProjectTagRow = typeof projectTags.$inferSelect;
export type NewProjectTagRow = typeof projectTags.$inferInsert;
export type TaskTagRow = typeof taskTags.$inferSelect;
export type NewTaskTagRow = typeof taskTags.$inferInsert;
