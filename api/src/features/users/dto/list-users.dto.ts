import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListUsersDto extends createZodDto(listUsersSchema) {}
