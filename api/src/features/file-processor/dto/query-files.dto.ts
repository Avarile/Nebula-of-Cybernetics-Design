import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Query params for listing files (coerced from strings). */
export const queryFilesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'AVAILABLE', 'QUARANTINED']).optional(),
  mimeType: z.string().min(1).optional(),
});

export class QueryFilesDto extends createZodDto(queryFilesSchema) {}
