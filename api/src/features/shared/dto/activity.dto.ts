import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ACTIVITY_ENTITY_TYPES = [
  'project',
  'task',
  'goal',
  'milestone',
  'knowledge',
  'contact',
  'contact_company',
  'invoice',
  'transaction',
  'user',
  'system',
] as const;

export const listActivitySchema = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES).optional(),
  entityId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListActivityDto extends createZodDto(listActivitySchema) {}
