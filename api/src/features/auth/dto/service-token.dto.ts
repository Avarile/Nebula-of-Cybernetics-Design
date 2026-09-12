import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
export const serviceTokenSchema = z.object({ apiKey: z.string().min(1) });
export class ServiceTokenDto extends createZodDto(serviceTokenSchema) {}
