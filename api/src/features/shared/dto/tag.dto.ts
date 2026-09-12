import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TAG_SCOPES = [
  'knowledge',
  'contact',
  'project',
  'task',
  'shared',
] as const;

export const createTagSchema = z.object({
  /** Slug. Lowercased by the service, so casing here is not significant. */
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'key must be alphanumeric with - or _'),
  label: z.string().min(1).max(120),
  scope: z.enum(TAG_SCOPES).default('shared'),
  color: z.string().max(16).optional(),
  description: z.string().max(500).optional(),
});

export class CreateTagDto extends createZodDto(createTagSchema) {}

export const updateTagSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    color: z.string().max(16).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateTagDto extends createZodDto(updateTagSchema) {}

export const listTagsSchema = z.object({
  scope: z.enum(TAG_SCOPES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListTagsDto extends createZodDto(listTagsSchema) {}
