import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MILESTONE_STATUSES = [
  'pending',
  'in_progress',
  'reached',
  'missed',
  'cancelled',
] as const;

export const GOAL_STATUSES = [
  'draft',
  'active',
  'at_risk',
  'achieved',
  'missed',
  'cancelled',
] as const;

export const createMilestoneSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(20_000).optional(),
  status: z.enum(MILESTONE_STATUSES).default('pending'),
  dueDate: z.coerce.date().optional(),
  ownerUserId: z.string().uuid().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export class CreateMilestoneDto extends createZodDto(createMilestoneSchema) {}

export const updateMilestoneSchema = createMilestoneSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateMilestoneDto extends createZodDto(updateMilestoneSchema) {}

export const createGoalSchema = z
  .object({
    kind: z.enum(['objective', 'key_result']).default('objective'),
    parentGoalId: z.string().uuid().optional(),
    title: z.string().min(1).max(500),
    description: z.string().max(20_000).optional(),
    ownerUserId: z.string().uuid().optional(),
    status: z.enum(GOAL_STATUSES).default('active'),
    metricName: z.string().max(120).optional(),
    targetValue: z
      .string()
      .regex(/^-?\d+(\.\d{1,4})?$/)
      .optional(),
    currentValue: z
      .string()
      .regex(/^-?\d+(\.\d{1,4})?$/)
      .optional(),
    unit: z.string().max(40).optional(),
    /** Without it, "current 40 of target 30" is unreadable. */
    direction: z.enum(['increase', 'decrease', 'maintain']).optional(),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    // A key result measures something beneath an objective; an objective is the
    // thing being measured towards. Enforced here so the message can explain it.
    if (v.kind === 'key_result' && !v.parentGoalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentGoalId'],
        message: 'A key result must belong to an objective',
      });
    }
    if (v.kind === 'objective' && v.parentGoalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentGoalId'],
        message: 'An objective cannot have a parent',
      });
    }
  });

export class CreateGoalDto extends createZodDto(createGoalSchema) {}

export const updateGoalSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(20_000).nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    status: z.enum(GOAL_STATUSES).optional(),
    metricName: z.string().max(120).nullable().optional(),
    targetValue: z
      .string()
      .regex(/^-?\d+(\.\d{1,4})?$/)
      .nullable()
      .optional(),
    currentValue: z
      .string()
      .regex(/^-?\d+(\.\d{1,4})?$/)
      .nullable()
      .optional(),
    unit: z.string().max(40).nullable().optional(),
    direction: z
      .enum(['increase', 'decrease', 'maintain'])
      .nullable()
      .optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateGoalDto extends createZodDto(updateGoalSchema) {}
