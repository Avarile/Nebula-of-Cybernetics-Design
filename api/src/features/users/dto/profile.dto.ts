import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    firstName: z.string().max(120).nullable().optional(),
    lastName: z.string().max(120).nullable().optional(),
    avatarFileId: z.string().uuid().nullable().optional(),
    jobTitle: z.string().max(150).nullable().optional(),
    department: z.string().max(150).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    /** IANA zone — the notification scheduler reads it for quiet hours. */
    timezone: z.string().max(64).optional(),
    /** Selects the notification template; falls back to `en`. */
    locale: z.string().max(16).optional(),
    dateFormat: z.string().max(32).nullable().optional(),
    timeFormat: z.string().max(32).nullable().optional(),
    bio: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}

export const setPreferenceSchema = z
  .object({
    value: z.unknown(),
    type: z.enum(['string', 'number', 'boolean', 'json']),
  })
  .superRefine((data, ctx) => {
    const ok =
      (data.type === 'string' && typeof data.value === 'string') ||
      (data.type === 'number' && typeof data.value === 'number') ||
      (data.type === 'boolean' && typeof data.value === 'boolean') ||
      (data.type === 'json' &&
        typeof data.value === 'object' &&
        data.value !== null);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value does not match declared type "${data.type}"`,
      });
    }
  });

export class SetPreferenceDto extends createZodDto(setPreferenceSchema) {}
