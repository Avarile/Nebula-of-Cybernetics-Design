import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Targeting rules. All optional; an empty object means "global switch only". */
export const rolloutSchema = z.object({
  userIds: z.array(z.string().uuid()).max(200).optional(),
  roles: z.array(z.enum(['guest', 'user', 'admin', 'agent'])).optional(),
  percentage: z.number().int().min(0).max(100).optional(),
});

export const upsertFeatureFlagSchema = z.object({
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(false),
  rollout: rolloutSchema.default({}),
  /** A flag with no expiry quietly becomes permanent configuration. */
  expiresAt: z.coerce.date().optional(),
});

export class UpsertFeatureFlagDto extends createZodDto(
  upsertFeatureFlagSchema,
) {}
