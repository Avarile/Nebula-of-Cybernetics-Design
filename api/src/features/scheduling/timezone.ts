/**
 * Wall clock <-> UTC instant, through an IANA zone.
 *
 * Deliberately dependency-free. `Intl.DateTimeFormat` already ships the full
 * IANA database in Node, so pulling in a date library would add a second copy
 * of the tzdata that has to be kept current independently of the runtime's.
 *
 * The direction that matters is `fromWallClock`. Converting an instant to local
 * parts is unambiguous; converting local parts to an instant is not — a
 * spring-forward makes some wall clocks nonexistent and a fall-back makes
 * others happen twice — and getting that wrong is how "the 9am reminder fired
 * at 8am, but only in October" reaches production.
 */

/** A floating date-time: what a clock on the wall reads, with no zone. */
export interface WallClock {
  year: number;
  /** 1-12, not the 0-11 `Date` uses. Off-by-one here is silent and seasonal. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * Cached per zone. Constructing an `Intl.DateTimeFormat` is expensive enough
 * that doing it per occurrence turns a 90-day expansion into a profiler entry.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // `hourCycle: 'h23'` — with the default, midnight formats as hour `24`
      // of the previous day and every derived date is a day off.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether the runtime's tzdata knows this zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The local reading of an instant in a zone. */
export function toWallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The zone's offset from UTC at an instant, in ms (east of UTC is positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = toWallClock(instant, timeZone);
  return asUtcMs(wall) - instant.getTime();
}

/**
 * The instant at which a zone's clock reads this wall time.
 *
 * Two lookups, because the offset depends on the answer we are solving for.
 * Guess with the offset in force at the same numeric instant, correct, and
 * check. When the two offsets disagree the wall clock sits on a transition:
 *
 *  - **Fall back** (the reading happens twice) — take the EARLIER instant. A
 *    reminder set for 01:30 should fire the first time 01:30 comes round, not
 *    an hour into the repeat.
 *  - **Spring forward** (the reading never happens) — take the instant just
 *    after the gap, so 02:30 on a night the clocks skip 02:00-03:00 fires at
 *    03:30. Silently dropping the occurrence would be the other option, and it
 *    is worse: an event vanishes once a year with no error anywhere.
 */
export function fromWallClock(wall: WallClock, timeZone: string): Date {
  const target = asUtcMs(wall);
  const firstOffset = zoneOffsetMs(new Date(target), timeZone);
  const first = target - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(first), timeZone);
  if (firstOffset === secondOffset) return new Date(first);

  const second = target - secondOffset;
  const firstValid = renders(first, wall, timeZone);
  const secondValid = renders(second, wall, timeZone);

  if (firstValid && secondValid) return new Date(Math.min(first, second));
  if (firstValid) return new Date(first);
  if (secondValid) return new Date(second);
  // Neither candidate reads back as the requested wall clock: the time does not
  // exist. The later candidate is the far side of the gap.
  return new Date(Math.max(first, second));
}

/** Whether an instant reads back as exactly this wall clock in the zone. */
function renders(
  instantMs: number,
  wall: WallClock,
  timeZone: string,
): boolean {
  return asUtcMs(toWallClock(new Date(instantMs), timeZone)) === asUtcMs(wall);
}

/**
 * Treat a wall clock as if it were UTC. Not a conversion — a way to do civil
 * calendar arithmetic (which UTC, having no DST, performs correctly) before
 * applying a zone.
 */
export function asUtcMs(wall: WallClock): number {
  return Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
}

/** The inverse of {@link asUtcMs}. */
export function fromUtcMs(ms: number): WallClock {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** `YYYY-MM-DD HH:MM:SS` — the form Postgres reads and writes for `timestamp`. */
export function formatWallClock(wall: WallClock): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)} ` +
    `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`
  );
}

/**
 * Parse what Postgres returns for a `timestamp without time zone`, and the
 * ISO-ish form an API client sends. Accepts `T` or a space, and an optional
 * fractional part, which pg appends when the value has sub-second precision.
 */
export function parseWallClock(value: string): WallClock {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(
      value.trim(),
    );
  if (!match) {
    throw new Error(
      `Invalid wall-clock timestamp "${value}" — expected YYYY-MM-DD HH:MM[:SS]`,
    );
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? '0'),
  };
}

/** Add wall-clock minutes. Civil arithmetic — no zone, so no DST interaction. */
export function addWallClockMinutes(
  wall: WallClock,
  minutes: number,
): WallClock {
  return fromUtcMs(asUtcMs(wall) + minutes * 60_000);
}
