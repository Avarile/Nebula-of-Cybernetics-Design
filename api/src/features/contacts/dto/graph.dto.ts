import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RELATIONSHIP_TYPES = [
  'colleague',
  'reports_to',
  'manages',
  'spouse',
  'family',
  'friend',
  'referred_by',
  'introduced_by',
  'advisor_to',
  'other',
] as const;

export const INTERACTION_KINDS = [
  'email_in',
  'email_out',
  'call',
  'meeting',
  'note',
  'task',
  'other',
] as const;

export const createRelationshipSchema = z.object({
  toContactId: z.string().uuid(),
  type: z.enum(RELATIONSHIP_TYPES),
  strength: z.enum(['weak', 'moderate', 'strong']).optional(),
  since: z.coerce.date().optional(),
  note: z.string().max(500).optional(),
});

export class CreateRelationshipDto extends createZodDto(
  createRelationshipSchema,
) {}

export const createInteractionSchema = z.object({
  kind: z.enum(INTERACTION_KINDS),
  /** The event time, not the row time. Defaults to now. */
  occurredAt: z.coerce.date().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().max(50_000).optional(),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  projectId: z.string().uuid().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(10_000).optional(),
});

export class CreateInteractionDto extends createZodDto(
  createInteractionSchema,
) {}

export const listInteractionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListInteractionsDto extends createZodDto(listInteractionsSchema) {}
