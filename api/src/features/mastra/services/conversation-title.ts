/** Longest conversation title we hand to the client, ellipsis included. */
export const TITLE_MAX = 80;

/**
 * Normalise a raw thread title into something a one-line history rail can show.
 *
 * Mastra's `generateTitle` writes to `mastra.mastra_threads.title` and is not
 * reliably short — in practice it sometimes stores the model's entire reply
 * there — so every title reaching the client goes through this first.
 *
 * Returns `null` for blank input so callers can `??` their way down a fallback
 * chain (explicit title -> Mastra-generated title -> client-side default).
 */
export function sanitizeTitle(raw?: string | null): string | null {
  const flat = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  if (flat.length <= TITLE_MAX) return flat;
  return `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}
