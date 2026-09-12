import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
  newPassword: z.string().min(12).max(200),
});

export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
