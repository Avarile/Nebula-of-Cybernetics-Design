import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const grantRoleSchema = z.object({
  /** Stable role key (`project_manager`), not an id — ids are not portable. */
  roleKey: z.string().min(1).max(60),
  /** Time-boxed elevation. Omit for a permanent grant. */
  expiresAt: z.coerce.date().optional(),
});

export class GrantRoleDto extends createZodDto(grantRoleSchema) {}

/**
 * A per-user exception to the role grants.
 *
 * `reason` is mandatory and deliberately so: the column is NOT NULL because an
 * exception without a recorded reason becomes permanent by amnesia. The DTO
 * enforces it at the boundary rather than letting the database be the one to
 * say no.
 */
export const grantPermissionSchema = z.object({
  /** Stable permission key (`finance.read`), matching the catalog. */
  permissionKey: z.string().min(1).max(120),
  /** `deny` wins over every role grant; `allow` adds to them. */
  effect: z.enum(['allow', 'deny']),
  reason: z.string().min(1).max(500),
  /** Time-boxed exception. Omit for one that stands until revoked. */
  expiresAt: z.coerce.date().optional(),
});

export class GrantPermissionDto extends createZodDto(grantPermissionSchema) {}
