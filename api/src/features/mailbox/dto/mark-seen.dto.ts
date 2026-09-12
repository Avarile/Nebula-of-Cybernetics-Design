import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const markSeenSchema = z.object({ seen: z.boolean() });
export class MarkSeenDto extends createZodDto(markSeenSchema) {}
