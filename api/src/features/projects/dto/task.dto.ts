import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PRIORITIES } from './project.dto';

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
] as const;

export const DEPENDENCY_TYPES = [
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
  'start_to_finish',
] as const;

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(200_000).optional(),
  status: z.enum(TASK_STATUSES).default('todo'),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeUserId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
  estimateMinutes: z.coerce.number().int().min(0).max(100_000).optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

export class CreateTaskDto extends createZodDto(createTaskSchema) {}

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(200_000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeUserId: z.string().uuid().nullable().optional(),
    milestoneId: z.string().uuid().nullable().optional(),
    estimateMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000)
      .nullable()
      .optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    /** Required by the service when moving to `blocked`. */
    blockedReason: z.string().max(500).nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}

export const listTasksSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListTasksDto extends createZodDto(listTasksSchema) {}

/** Move a task within (or between) board columns. */
export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  /** The task this one should sit after; omit for the top of the column. */
  afterTaskId: z.string().uuid().nullable().optional(),
});

export class MoveTaskDto extends createZodDto(moveTaskSchema) {}

export const addDependencySchema = z.object({
  predecessorTaskId: z.string().uuid(),
  type: z.enum(DEPENDENCY_TYPES).default('finish_to_start'),
  lagDays: z.coerce.number().int().min(0).max(365).default(0),
});

export class AddDependencyDto extends createZodDto(addDependencySchema) {}

export const logTimeSchema = z.object({
  minutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  /** The day the work is attributed to — not derivable across time zones. */
  workDate: z.coerce.date(),
  startedAt: z.coerce.date().optional(),
  description: z.string().max(500).optional(),
  isBillable: z.boolean().default(false),
  hourlyRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
});

export class LogTimeDto extends createZodDto(logTimeSchema) {}

/**
 * Correct a logged entry.
 *
 * `taskId` and `projectId` are deliberately absent: moving an hour between
 * projects would change which budget it lands on and which invoice may bill
 * it. Delete and re-log for that.
 */
export const updateTimeSchema = logTimeSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateTimeDto extends createZodDto(updateTimeSchema) {}

export const listTimeSchema = z.object({
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export class ListTimeDto extends createZodDto(listTimeSchema) {}
