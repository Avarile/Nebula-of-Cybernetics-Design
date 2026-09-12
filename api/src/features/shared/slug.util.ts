/**
 * URL-safe identifiers derived from human text.
 *
 * Two callers with two different ceilings: `knowledge.slug` (varchar 255, the
 * article's public handle) and the vocabulary `key` columns (varchar 60, the
 * segment every materialized `path` is built from). The rules are the same, so
 * the function is one and the length is the parameter — a second copy would be
 * a second set of edge cases to get wrong.
 */

/** `Title Case Words` -> `title-case-words`, clipped to `maxLength`. */
export function slugify(text: string, maxLength = 200): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    // The slice lands mid-separator often enough to matter: `foo-bar-baz` cut
    // at 8 is `foo-bar-`, which is a valid key but an ugly path segment.
    .replace(/-+$/, '');
  return base || 'untitled';
}
