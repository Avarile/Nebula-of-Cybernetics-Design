import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../principal';

/** Metadata key holding the roles allowed to access a route. */
export const ROLES_KEY = 'roles';

/** Restrict a route (or controller) to the given roles (RolesGuard). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
