import { fromWallClock, isValidTimeZone, parseWallClock } from './timezone';

/**
 * Turn a range the VIEWER asked for into the UTC bounds a query needs.
 *
 * This exists because "September" is not a UTC range. `09:00 on 1 September` in
 * Melbourne is `23:00 on 31 August` UTC, so a range query built from
 * `2025-09-01T00:00:00Z` silently drops it — and the bug reaches production
 * looking like "sometimes an event is missing from the first day of the month",
 * which nobody reports as a timezone problem.
 *
 * The rule is that the conversion happens once, at the API boundary, where the
 * viewer's zone is known. Nothing below this line should be doing zone
 * arithmetic on a range.
 */

export interface UtcWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
}

/**
 * `fromLocal`/`toLocal` are wall-clock strings (`YYYY-MM-DD`, optionally with a
 * time). `toLocal` is exclusive, so a whole day is `2025-09-01` → `2025-09-02`.
 */
export function localWindowToUtc(
  fromLocal: string,
  toLocal: string,
  timeZone: string,
): UtcWindow {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Unknown IANA time zone "${timeZone}"`);
  }
  const from = fromWallClock(parseWallClock(withTime(fromLocal)), timeZone);
  const to = fromWallClock(parseWallClock(withTime(toLocal)), timeZone);
  if (to.getTime() <= from.getTime()) {
    throw new Error('Window end must be after its start');
  }
  return { from, to };
}

/** The UTC bounds of a local calendar month. `month` is 1-12. */
export function localMonthToUtc(
  year: number,
  month: number,
  timeZone: string,
): UtcWindow {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return localWindowToUtc(
    `${pad4(year)}-${pad2(month)}-01`,
    `${pad4(nextYear)}-${pad2(nextMonth)}-01`,
    timeZone,
  );
}

/** A bare `YYYY-MM-DD` means midnight local, not midnight UTC. */
function withTime(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()} 00:00:00`
    : value;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');
