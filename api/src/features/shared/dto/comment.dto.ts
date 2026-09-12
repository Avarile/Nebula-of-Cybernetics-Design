import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const COMMENTABLE_TYPES = [
  'project',
  'task',
  'goal',
  'milestone',
  'knowledge',
  'contact',
  'invoice',
] as const;

/** Cap on one comment's mentions — a mention fans out to a notification each. */
const MAX_MENTIONS = 20;

export const createCommentSchema = z.object({
  entityType: z.enum(COMMENTABLE_TYPES),
  entityId: z.string().uuid(),
  body: z.string().min(1).max(20_000),
  parentCommentId: z.string().uuid().optional(),
  /**
   * Ids of users being mentioned. Verified against live user accounts by the
   * service; dispatch re-checks that each mentioned user may read the parent
   * entity before any notification is sent.
   */
  mentionUserIds: z.array(z.string().uuid()).max(MAX_MENTIONS).default([]),
});

export class CreateCommentDto extends createZodDto(createCommentSchema) {}

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(20_000),
});

export class UpdateCommentDto extends createZodDto(updateCommentSchema) {}

export const listCommentsSchema = z.object({
  entityType: z.enum(COMMENTABLE_TYPES),
  entityId: z.string().uuid(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListCommentsDto extends createZodDto(listCommentsSchema) {}
