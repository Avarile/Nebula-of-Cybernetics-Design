import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listMessagesSchema = z.object({
  accountId: z.string().uuid().optional(),
  mailbox: z.string().min(1).max(255).default('INBOX'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  // z.coerce.boolean() uses JS truthiness, so the query string 'false' would
  // coerce to true (any non-empty string is truthy). Only 'true' / '1' /
  // boolean true map to true; everything else (including 'false', '0', and
  // absent) maps to false.
  unseenOnly: z
    .preprocess((v) => v === true || v === 'true' || v === '1', z.boolean())
    .default(false),
});
export class ListMessagesDto extends createZodDto(listMessagesSchema) {}
