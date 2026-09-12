import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateUserSchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    password: z.string().min(12).max(200).optional(),
    displayName: z.string().min(1).max(255).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
