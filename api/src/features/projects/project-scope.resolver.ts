import { isAdmin, type Principal } from '../../common/principal';
import type {
  ProjectMemberRow,
  ProjectRow,
} from '../../infrastructure/database/schema/project.schema';

/** Ordered most- to least-capable; index is the comparison. */
export const MEMBER_ROLE_ORDER = [
  'owner',
  'manager',
  'contributor',
  'viewer',
] as const;

export type ProjectRole = (typeof MEMBER_ROLE_ORDER)[number];
export type ProjectAccess = ProjectRole | 'none';

/** The parts of a project the decision depends on. */
export interface ProjectScopeInput {
  ownerUserId: string | null;
  visibility: ProjectRow['visibility'];
}

/** True when `held` is at least as capable as `needed`. */
export function permitsProject(
  held: ProjectAccess,
  needed: ProjectRole,
): boolean {
  if (held === 'none') return false;
  // Lower index = more capable, so the comparison inverts.
  return MEMBER_ROLE_ORDER.indexOf(held) <= MEMBER_ROLE_ORDER.indexOf(needed);
}

/**
 * Decide a principal's role on a project.
 *
 * Everything beneath a project — tasks, milestones, goals, comments,
 * attachments, time entries — inherits this. There is deliberately no per-task
 * ACL: a second authorization path for rows that always belong to a project is
 * a second thing to get wrong.
 *
 * Pure, taking the membership row as an argument, so the truth table is
 * exhaustively testable. Fails closed.
 */
export function resolveProjectAccess(
  project: ProjectScopeInput,
  principal: Principal,
  membership: Pick<ProjectMemberRow, 'roleInProject'> | null,
): ProjectAccess {
  if (isAdmin(principal)) return 'owner';
  if (principal.kind === 'system') return 'owner';
  if (principal.kind === 'anonymous') return 'none';

  if (
    principal.kind === 'user' &&
    project.ownerUserId !== null &&
    project.ownerUserId === principal.userId
  ) {
    return 'owner';
  }

  if (membership) return membership.roleInProject;

  // `internal` is the coarse "anyone in the company may look" case, expressed
  // once instead of as a viewer row per user.
  if (project.visibility === 'internal') {
    return principal.kind === 'user' || principal.kind === 'service'
      ? 'viewer'
      : 'none';
  }

  return 'none';
}
