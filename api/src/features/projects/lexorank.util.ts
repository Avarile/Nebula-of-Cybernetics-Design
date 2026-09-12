/**
 * Lexicographic ranks for drag-and-drop ordering.
 *
 * A task board reorders constantly. With an integer `sort_order`, moving one
 * card rewrites every row after it; with a rank string, a move writes exactly
 * one row, because a new rank can always be generated *between* two existing
 * ones.
 *
 * Ranks are base-36 strings compared bytewise, so ordering is whatever
 * Postgres's `ORDER BY sort_rank` already does — no application-side sort.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;
const MID = ALPHABET[Math.floor(BASE / 2)]; // 'i'

/** First rank in an empty list. */
export function initialRank(): string {
  return MID;
}

/**
 * A rank strictly between `before` and `after`.
 *
 * Either bound may be null, meaning "start of list" / "end of list". When the
 * two bounds are adjacent with no room between them, the result extends the
 * string by one character rather than failing — which is why ranks grow slowly
 * over time and why {@link needsRebalance} exists.
 */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  const lo = before ?? '';
  const hi = after ?? '';

  if (lo && hi && lo >= hi) {
    throw new Error(
      `rankBetween requires before < after (got "${lo}", "${hi}")`,
    );
  }

  let prefix = '';
  let i = 0;
  for (;;) {
    const loChar = lo[i] ?? ALPHABET[0];
    const hiChar = hi[i] ?? undefined;
    const loIdx = ALPHABET.indexOf(loChar);
    const hiIdx = hiChar === undefined ? BASE : ALPHABET.indexOf(hiChar);

    if (hiIdx - loIdx > 1) {
      const midIdx = Math.floor((loIdx + hiIdx) / 2);
      return prefix + ALPHABET[midIdx];
    }

    // No gap at this position: keep the shared prefix and look one deeper.
    prefix += loChar;
    i += 1;

    // Past the end of the lower bound with the upper bound immediately above:
    // append a midpoint, which is always strictly between the two.
    if (i >= lo.length && hiIdx - loIdx <= 1 && hi.length <= i) {
      return prefix + MID;
    }
  }
}

/**
 * Whether ranks have grown long enough to warrant a rebalance.
 *
 * Repeated insertion at the same point lengthens the string by a character each
 * time. Comparison keeps working, but `sort_rank` is `varchar(64)` and Postgres
 * errors rather than truncates on overflow — measured at roughly one character
 * per five "move to top" gestures, so a busy column reaches the limit in a few
 * hundred drags and then starts rejecting them.
 */
export function needsRebalance(ranks: string[], maxLength = 12): boolean {
  return ranks.some((r) => r.length > maxLength);
}

/**
 * Evenly spaced, strictly ascending ranks for `count` items.
 *
 * Fixed-width, in the smallest base-36 width that fits `count` values with room
 * between them. The previous single-character version saturated: with
 * `step = floor(36 / (count + 1))` and the index clamped to `BASE - 1`, every
 * rank past the 35th came out `'z'`, so rebalancing a 40-card column produced
 * duplicates and destroyed its order. The spec only ever asked for five, which
 * is why that went unnoticed — and why the helper had no callers to break.
 */
export function evenlySpacedRanks(count: number): string[] {
  if (count <= 0) return [];
  // Leave `count + 1` gaps so there is room to insert at either end and between
  // any pair without immediately lengthening the string again.
  let width = 1;
  let capacity = BASE;
  while (capacity < count + 2) {
    width += 1;
    capacity *= BASE;
  }
  const step = Math.floor(capacity / (count + 1));
  return Array.from({ length: count }, (_, i) => encode(step * (i + 1), width));
}

/** `value` as a fixed-width base-36 string, so all ranks compare bytewise. */
function encode(value: number, width: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < width; i++) {
    out = ALPHABET[n % BASE] + out;
    n = Math.floor(n / BASE);
  }
  return out;
}
