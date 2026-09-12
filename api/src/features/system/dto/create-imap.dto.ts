import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createImapSchema = z.object({
  name: z.string().min(1).max(255),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  secret: z.string().min(1).max(1024).optional(),
  secure: z.boolean().default(true),
});

export class CreateImapDto extends createZodDto(createImapSchema) {}
