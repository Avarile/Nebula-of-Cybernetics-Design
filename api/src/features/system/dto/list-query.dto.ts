import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Shared pagination for system list endpoints. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListQueryDto extends createZodDto(listQuerySchema) {}

/** Audit list filters (extends pagination). */
export const auditQuerySchema = listQuerySchema.extend({
  entityType: z.enum(['smtp', 'imap', 'integration', 'setting']).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
});

export class AuditQueryDto extends createZodDto(auditQuerySchema) {}
