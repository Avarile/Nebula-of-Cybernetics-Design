import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listNotificationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListNotificationsDto extends createZodDto(
  listNotificationsSchema,
) {}

export const setNotificationPreferenceSchema = z.object({
  /** Event key, not id — ids are not portable between environments. */
  eventKey: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  frequency: z
    .enum(['immediate', 'hourly', 'daily', 'weekly', 'off'])
    .default('immediate'),
  quietHoursStart: z.coerce.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).nullable().optional(),
});

export class SetNotificationPreferenceDto extends createZodDto(
  setNotificationPreferenceSchema,
) {}

export const upsertTemplateSchema = z.object({
  locale: z.string().max(16).default('en'),
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional(),
  subjectTemplate: z.string().min(1).max(500),
  bodyTextTemplate: z.string().min(1).max(50_000),
  bodyHtmlTemplate: z.string().max(200_000).optional(),
  /** Declared variables, validated on save and at enqueue. */
  variables: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

export class UpsertTemplateDto extends createZodDto(upsertTemplateSchema) {}

export const suppressSchema = z.object({
  email: z.string().email().max(320),
  reason: z.enum([
    'hard_bounce',
    'soft_bounce_repeated',
    'complaint',
    'unsubscribe',
    'manual',
    'invalid',
  ]),
  eventKey: z.string().max(120).optional(),
  /** Soft bounces expire; hard bounces should not. */
  expiresAt: z.coerce.date().optional(),
  note: z.string().max(500).optional(),
});

export class SuppressDto extends createZodDto(suppressSchema) {}
