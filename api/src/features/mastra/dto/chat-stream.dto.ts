import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const chatStreamSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    message: z.string().min(1).max(8000).optional(),
    resume: z
      .object({ approvalId: z.string().uuid(), approved: z.boolean() })
      .optional(),
  })
  .refine((v) => Boolean(v.message) !== Boolean(v.resume), {
    message: 'Provide exactly one of `message` or `resume`',
  });

export class ChatStreamDto extends createZodDto(chatStreamSchema) {}
