import { isAdmin, type Principal } from '../../common/principal';
import type {
  KnowledgeAccessControlRow,
  KnowledgeRow,
} from '../../infrastructure/database/schema/knowledge.schema';

/** Ordered from least to most capable; index is the comparison. */
export const PERMISSION_ORDER = ['read', 'comment', 'write', 'manage'] as const;

export type KnowledgePermission = (typeof PERMISSION_ORDER)[number];

/** The outcome of applying a record's policy to a principal. */
export type KnowledgeAccess = KnowledgePermission | 'none';

/** The parts of a knowledge record the decision depends on. */
export interface KnowledgeScopeInput {
  ownerUserId: string | null;
  visibility: KnowledgeRow['visibility'];
}

/** A grant, reduced to what the decision needs. */
export interface KnowledgeGrant {
  granteeType: KnowledgeAccessControlRow['granteeType'];
  granteeUserId: string | null;
  granteeRoleId: string | null;
  permission: KnowledgePermission;
  expiresAt: Date | null;
}

/** True when `held` is at least as capable as `needed`. */
export function permits(
  held: KnowledgeAccess,
  needed: KnowledgePermission,
): boolean {
  if (held === 'none') return false;
  return PERMISSION_ORDER.indexOf(held) >= PERMISSION_ORDER.indexOf(needed);
}

/**
 * Decide what a principal may do with a knowledge record.
 *
 * Grant-only: there is no deny. A deny rule makes access an order-dependent
 * evaluation, and "why can this person see this?" stops being a set-membership
 * question. The three needs a deny usually covers are met otherwise — revoke by
 * removing the grant, restrict with `visibility = 'private'`, quarantine with
 * `status = 'archived'`.
 *
 * Pure, and takes the grants and role ids it needs as arguments, so the truth
 * table is exhaustively testable without a database.
 *
 * Fails closed on every path not explicitly allowed, including an unrecognised
 * visibility.
 */
export function resolveKnowledgeAccess(
  record: KnowledgeScopeInput,
  principal: Principal,
  grants: KnowledgeGrant[],
  principalRoleIds: string[] = [],
  now: Date = new Date(),
): KnowledgeAccess {
  if (isAdmin(principal)) return 'manage';
  if (principal.kind === 'system') return 'manage';
  if (principal.kind === 'anonymous') return 'none';

  // The owner always manages their own record; an owner locked out of it by a
  // missing grant row would be unable to fix the grant.
  if (
    principal.kind === 'user' &&
    record.ownerUserId !== null &&
    record.ownerUserId === principal.userId
  ) {
    return 'manage';
  }

  let best: KnowledgeAccess = 'none';
  /** Keep the most capable match; grants combine by taking the maximum. */
  const raise = (candidate: KnowledgePermission) => {
    if (
      best === 'none' ||
      PERMISSION_ORDER.indexOf(candidate) > PERMISSION_ORDER.indexOf(best)
    ) {
      best = candidate;
    }
  };

  // `internal` is the common case expressed once. Without it, "everyone may read
  // the handbook" would be one grant row per user.
  if (record.visibility === 'internal') raise('read');

  for (const grant of grants) {
    // Filtered at READ time, not only by a sweep: a stalled cleanup job must not
    // leave a lapsed share standing.
    if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) continue;

    switch (grant.granteeType) {
      case 'user':
        if (
          principal.kind === 'user' &&
          grant.granteeUserId === principal.userId
        ) {
          raise(grant.permission);
        }
        break;
      case 'role':
        if (
          grant.granteeRoleId &&
          principalRoleIds.includes(grant.granteeRoleId)
        ) {
          raise(grant.permission);
        }
        break;
      case 'authenticated':
        // Any authenticated principal, service credentials included — they are
        // authenticated callers running a pipeline, not anonymous ones.
        raise(grant.permission);
        break;
      default:
        // An unrecognised grantee type grants nothing.
        break;
    }
  }

  return best;
}
