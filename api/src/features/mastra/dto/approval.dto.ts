import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const decisionSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(1000).optional(),
});

export class DecisionDto extends createZodDto(decisionSchema) {}
