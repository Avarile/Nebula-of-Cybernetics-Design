/** Allowed numeric range per field, in 6-field (seconds-first) order. */
const RANGES_6: ReadonlyArray<[number, number]> = [
  [0, 59], // second
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 are both Sunday)
];

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Resolve a `JAN`/`MON` style alias to its number, or NaN. */
function toNumber(token: string, fieldIndex: number): number {
  const lower = token.toLowerCase();
  const names = fieldIndex === 4 ? MONTHS : fieldIndex === 5 ? DAYS : [];
  const named = names.indexOf(lower);
  if (named >= 0) return fieldIndex === 4 ? named + 1 : named;
  return /^\d+$/.test(token) ? Number(token) : Number.NaN;
}

/** Validate one comma-separated field against its range. */
function validField(field: string, index: number): boolean {
  const [min, max] = RANGES_6[index];
  return field.split(',').every((part) => {
    if (part === '') return false;
    // `*/5` or `1-10/2` — a step over a base expression.
    const [base, step, ...rest] = part.split('/');
    if (rest.length > 0) return false;
    if (step !== undefined && !/^\d+$/.test(step)) return false;
    if (step !== undefined && Number(step) === 0) return false;
    if (base === '*') return true;

    const bounds = base.split('-');
    if (bounds.length > 2) return false;
    const numbers = bounds.map((b) => toNumber(b, index));
    if (numbers.some((n) => Number.isNaN(n) || n < min || n > max))
      return false;
    if (numbers.length === 2 && numbers[0] > numbers[1]) return false;
    return true;
  });
}

/**
 * Whether `expression` is a cron pattern BullMQ's parser will accept.
 *
 * Deliberately a local check rather than a new dependency: `cron-parser` is only
 * reachable transitively through bullmq's own tree. This is not a full
 * reimplementation — it will not reject every exotic form — but it catches the
 * failure this exists for. Registration used to happen *after* the row was
 * inserted, so a typo persisted a schedule that failed to register and then
 * failed again on every subsequent boot's `syncRepeatableJobs()`.
 *
 * Accepts 5-field (minute-first) and 6-field (seconds-first) patterns, `*`,
 * lists, ranges, steps, and `JAN`/`MON` style names.
 */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return false;
  // A 5-field pattern is the 6-field one without the leading seconds field.
  const offset = fields.length === 5 ? 1 : 0;
  return fields.every((field, i) => validField(field, i + offset));
}
