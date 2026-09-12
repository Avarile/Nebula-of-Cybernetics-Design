import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RETENTION_ENTITY_TYPES = [
  'activity_log',
  'system_event_log',
  'notifications',
  'notification_delivery_attempts',
  'sessions',
  'password_reset_codes',
  'email_messages',
  'search_records',
  'scheduled_job',
] as const;

export const EVENT_SEVERITIES = [
  'debug',
  'info',
  'warn',
  'error',
  'critical',
] as const;

export const updateRetentionSchema = z
  .object({
    enabled: z.boolean().optional(),
    /**
     * Bounded below at 1: a zero-day policy would delete rows as fast as they
     * are written, which is indistinguishable from the table not existing.
     */
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateRetentionDto extends createZodDto(updateRetentionSchema) {}

export const listSystemEventsSchema = z.object({
  severity: z.enum(EVENT_SEVERITIES).optional(),
  source: z.string().max(100).optional(),
  eventKey: z.string().max(120).optional(),
  correlationId: z.string().max(64).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export class ListSystemEventsDto extends createZodDto(listSystemEventsSchema) {}
