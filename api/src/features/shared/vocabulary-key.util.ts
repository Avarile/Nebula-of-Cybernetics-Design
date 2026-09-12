import { z } from 'zod';
import { slugify } from './slug.util';

/**
 * The `key` every admin vocabulary shares — knowledge and contact types and
 * categories.
 *
 * `key` is not an internal id: the CLI resolves `--category engineering` to a
 * uuid through it, and the seeder matches seeded rows by it, so it stays a
 * stable, typeable handle. For the category trees it is also the segment
 * `childPath` builds `path` from, which is why it is immutable after create —
 * a rename would otherwise drift every descendant's path.
 *
 * One module rather than a copy per feature: four create schemas and four
 * create methods agree on the rule, and the DTO regex had already drifted from
 * its own error message once.
 */

/** `varchar(60)` in every vocabulary table; keep in step with the schemas. */
export const KEY_MAX_LENGTH = 60;

export const keySchema = z
  .string()
  .min(1)
  .max(KEY_MAX_LENGTH)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    'key must be lowercase letters, digits, - or _',
  );

/**
 * Create-time `key`: omit it and the service derives one from `name`, the same
 * way `KnowledgeService.create` derives an article slug from its title.
 *
 * A plain `.optional()` — rather than a `z.preprocess` that would also swallow
 * `''` — keeps the OpenAPI output a clean `ZodOptional`, and that is what drops
 * `key` out of the CLI editor template's required set so the buffer renders it
 * commented out.
 */
export const optionalKeySchema = keySchema.optional();

/** What a create was asked for: an explicit key, or a name to derive one from. */
interface KeyedCreate {
  key?: string;
  name: string;
}

/** The key a create should use — the caller's, or one derived from `name`. */
export function deriveKey(dto: KeyedCreate): string {
  return dto.key ?? slugify(dto.name, KEY_MAX_LENGTH);
}

/**
 * Conflict text for a key that is already taken.
 *
 * A derived key is one the caller never typed, so the message has to name it
 * and say how to pick another — otherwise `Category "engineering" already
 * exists` answers a request that only ever mentioned "Engineering". Keys are
 * never auto-suffixed: an `engineering-2` nobody chose is unguessable at the
 * CLI, where the key IS how you address the row.
 */
export function keyConflictMessage(
  label: string,
  key: string,
  dto: KeyedCreate,
): string {
  return dto.key
    ? `${label} "${key}" already exists`
    : `${label} "${key}" (derived from "${dto.name}") already exists — pass an explicit key`;
}
