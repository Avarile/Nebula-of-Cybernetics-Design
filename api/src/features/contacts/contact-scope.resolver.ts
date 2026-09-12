import { isAdmin, type Principal } from '../../common/principal';
import type { ContactRow } from '../../infrastructure/database/schema/contact.schema';

/** What a principal may do with one contact. */
export type ContactAccess = 'none' | 'read' | 'manage';

/** The parts of a contact the decision depends on. */
export interface ContactScopeInput {
  ownerUserId: string | null;
  visibility: ContactRow['visibility'];
}

/**
 * Decide what a principal may do with a contact.
 *
 * Data, not exceptions — the same shape as `resolveReadScope` in the search
 * service, and for the same reason: it makes the truth table exhaustively
 * testable and lets the list query and the single-row read share one answer
 * instead of drifting apart.
 *
 * Fails closed on every path not explicitly allowed.
 */
export function resolveContactAccess(
  contact: ContactScopeInput,
  principal: Principal,
): ContactAccess {
  // Admins manage everything; internal pipelines read everything, for the same
  // reason `FileService` grants them — they run on behalf of the system, not a
  // person, and cannot be enumerated as an owner.
  if (isAdmin(principal)) return 'manage';
  if (principal.kind === 'system') return 'manage';
  if (principal.kind === 'anonymous') return 'none';

  if (principal.kind === 'user') {
    if (contact.ownerUserId === principal.userId) return 'manage';
    if (contact.visibility === 'shared') return 'read';
    return 'none';
  }

  // A service credential has no owning `users.id`, so ownership cannot apply;
  // it sees what is explicitly shared and nothing else.
  if (principal.kind === 'service') {
    return contact.visibility === 'shared' ? 'read' : 'none';
  }

  return 'none';
}

/** True when the access level permits mutation. */
export function canManageContact(access: ContactAccess): boolean {
  return access === 'manage';
}

/** True when the access level permits reading. */
export function canReadContact(access: ContactAccess): boolean {
  return access !== 'none';
}
