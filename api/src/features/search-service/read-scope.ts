import { isAdmin, type Principal } from '../../common/principal';
import type { CollectionVisibility } from '../../infrastructure/database/schema/search.schema';

/** The parts of a compiled collection the read policy depends on. */
export interface ReadScopeInput {
  name: string;
  visibility: CollectionVisibility;
  ownerField: string | null;
}

/**
 * The outcome of applying a collection's read policy to a principal.
 *
 * Deliberately data, not an exception: this keeps the policy a pure function
 * with an exhaustively testable truth table, and lets both consumers use the
 * same answer — `search()` turns `ownerFilter` into a Meili filter clause,
 * `get()` compares the field on the row it read from Postgres.
 */
export type ReadScope =
  | { allowed: true; ownerFilter: { field: string; userId: string } | null }
  | { allowed: false };

const ALLOW_ALL: ReadScope = { allowed: true, ownerFilter: null };
const DENY: ReadScope = { allowed: false };

/**
 * Decide what a principal may read from a collection.
 *
 * This is the single enforcement point for search reads. It exists because
 * scoping used to be the *caller's* job: `search-documents.tool.ts` applied an
 * owner filter, `search-query.tool.ts` did not, and `SearchQueryController`
 * did not — three call sites, three behaviours, one shared store. Moving the
 * decision here makes that divergence unrepresentable.
 *
 * Fails closed on every path that is not explicitly allowed, including an
 * unrecognised visibility and an `owner_scoped` collection whose `ownerField`
 * is missing.
 */
export function resolveReadScope(
  def: ReadScopeInput,
  principal: Principal,
): ReadScope {
  // Admins read everything (per the policy set in commit 6b58e65); internal
  // pipelines are privileged for the same reason `FileService` grants them.
  if (isAdmin(principal) || principal.kind === 'system') return ALLOW_ALL;

  switch (def.visibility) {
    case 'shared':
      // Any authenticated principal, including machine callers running an
      // ingestion pipeline. Anonymous is still refused.
      return principal.kind === 'user' || principal.kind === 'service'
        ? ALLOW_ALL
        : DENY;

    case 'owner_scoped': {
      // Only a human has an owning `users.id`; a service credential has none,
      // so there is no correct filter to emit for it.
      if (principal.kind !== 'user' || !def.ownerField) return DENY;
      return {
        allowed: true,
        ownerFilter: { field: def.ownerField, userId: principal.userId },
      };
    }

    case 'private':
    default:
      return DENY;
  }
}
