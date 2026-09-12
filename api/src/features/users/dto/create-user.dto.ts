import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(200),
  role: z.enum(['user', 'admin']).default('user'),
  displayName: z.string().min(1).max(255).optional(),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}
