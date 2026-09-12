import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
export const createServiceCredentialSchema = z.object({
  name: z.string().min(1).max(255),
});
export class CreateServiceCredentialDto extends createZodDto(
  createServiceCredentialSchema,
) {}
