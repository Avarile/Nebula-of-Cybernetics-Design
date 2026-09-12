import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { createIntegrationSchema } from './create-integration.dto';

export const updateIntegrationSchema = createIntegrationSchema.partial();

export class UpdateIntegrationDto extends createZodDto(
  updateIntegrationSchema,
) {}

/** Integration list filter (pagination + optional provider). */
export const integrationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  provider: z.string().min(1).max(100).optional(),
});

export class IntegrationQueryDto extends createZodDto(integrationQuerySchema) {}
