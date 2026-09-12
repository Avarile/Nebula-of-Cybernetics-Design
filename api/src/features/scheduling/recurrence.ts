import {
  addWallClockMinutes,
  asUtcMs,
  fromUtcMs,
  fromWallClock,
  toWallClock,
  type WallClock,
} from './timezone';

/**
 * Recurrence expansion, in floating time.
 *
 * The whole file operates on wall clocks and converts to instants only at the
 * very end. That ordering is the point: expanding in UTC and converting back
 * makes a 09:00 daily standup drift to 08:00 the morning after a DST change,
 * because "add 24 hours" and "the same time tomorrow" are different operations
 * for two days a year. `recurrence.spec.ts` asserts that the naive approach
 * really does drift, so this stays load-bearing rather than becoming folklore.
 *
 * Pure functions, no injection — the expander is the piece most worth testing
 * exhaustively, and it has no reason to know about the database.
 */

export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: Frequency;
  /** Every Nth period. `2` with `weekly` is fortnightly. */
  interval: number;
  /** WEEKLY only. `0 = Sunday` … `6 = Saturday`. Empty = the start's weekday. */
  byWeekday: number[];
  /** Total instances in the series, counted from its first. Null = open-ended. */
  count: number | null;
  /** Inclusive end of the series, in wall clock. */
  untilLocal: WallClock | null;
}

export interface SeriesDefinition {
  startLocal: WallClock;
  durationMinutes: number;
  timeZone: string;
  rule: RecurrenceRule;
}

export interface ExpandedOccurrence {
  /**
   * RECURRENCE-ID: the instant this instance would start at under the
   * unmodified rule. Its permanent identity, never rewritten by a later move.
   */
  originalStart: Date;
  startsAt: Date;
  endsAt: Date;
  startLocal: WallClock;
  endLocal: WallClock;
}

export interface ExpansionWindow {
  from: Date;
  to: Date;
}

const DAY_MS = 86_400_000;

/**
 * Hard ceiling on candidate periods considered in one call.
 *
 * A daily series iterates from its first instance whenever `count` is set (the
 * count cannot be honoured otherwise), so an open-ended cap is the difference
 * between a slow expansion and a wedged materializer. 20k periods is ~55 years
 * of daily recurrence.
 */
const MAX_PERIODS = 20_000;

/** Ceiling on instances returned from one call, whatever the window asks for. */
const MAX_OCCURRENCES = 1_000;

/**
 * Instances of `series` that overlap `window`.
 *
 * Overlap, not containment: an event that started before the window and is
 * still running belongs on the calendar you are looking at. Materialization
 * relies on the same semantics and is idempotent, so re-emitting one is free.
 */
export function expandSeries(
  series: SeriesDefinition,
  window: ExpansionWindow,
  limit: number = MAX_OCCURRENCES,
): ExpandedOccurrence[] {
  const { rule, timeZone } = series;
  const seriesStartMs = asUtcMs(series.startLocal);
  const untilMs = rule.untilLocal ? asUtcMs(rule.untilLocal) : null;
  const out: ExpandedOccurrence[] = [];

  if (rule.frequency === 'none') {
    const only = materialize(series, seriesStartMs);
    return overlaps(only, window) ? [only] : [];
  }

  const interval = Math.max(1, Math.trunc(rule.interval));
  const weekdays = normalizeWeekdays(rule, series.startLocal);
  // Bounds for the floating loop. Approximate at a transition by up to an hour,
  // which the exact instant filter below corrects; the day of slack absorbs it.
  const windowFromLocal = asUtcMs(toWallClock(window.from, timeZone)) - DAY_MS;
  const windowToLocal = asUtcMs(toWallClock(window.to, timeZone)) + DAY_MS;

  // Skipping ahead is only sound when nothing counts the instances we skip.
  const firstPeriod =
    rule.count === null
      ? firstPeriodNear(
          series.startLocal,
          rule.frequency,
          interval,
          windowFromLocal,
        )
      : 0;

  let emitted = 0;
  for (let period = firstPeriod; period - firstPeriod < MAX_PERIODS; period++) {
    const candidates = periodCandidates(
      series.startLocal,
      rule.frequency,
      interval,
      period,
      weekdays,
    );
    // A period can be empty — the 31st of a 30-day month, 29 February in a
    // common year. RFC 5545 ignores invalid dates; they consume no COUNT.
    if (candidates.length === 0) continue;

    let periodStarted = false;
    for (const candidateMs of candidates) {
      // Weekly blocks are anchored to the week containing the series start, so
      // the first block can contain days before it.
      if (candidateMs < seriesStartMs) continue;
      if (untilMs !== null && candidateMs > untilMs) return out;
      emitted += 1;
      if (rule.count !== null && emitted > rule.count) return out;
      periodStarted = true;
      if (candidateMs > windowToLocal) return out;

      const occurrence = materialize(series, candidateMs);
      if (overlaps(occurrence, window)) {
        out.push(occurrence);
        if (out.length >= limit) return out;
      }
    }
    // Nothing in this period was even a candidate and we are already past the
    // window: further periods only move away from it.
    if (!periodStarted && candidates[0] > windowToLocal) return out;
  }
  return out;
}

/** Turn one floating instant into a full occurrence, applying the zone last. */
function materialize(
  series: SeriesDefinition,
  startCivilMs: number,
): ExpandedOccurrence {
  const startLocal = fromUtcMs(startCivilMs);
  const endLocal = addWallClockMinutes(startLocal, series.durationMinutes);
  const startsAt = fromWallClock(startLocal, series.timeZone);
  return {
    originalStart: startsAt,
    startsAt,
    endsAt: fromWallClock(endLocal, series.timeZone),
    startLocal,
    endLocal,
  };
}

function overlaps(
  occurrence: ExpandedOccurrence,
  window: ExpansionWindow,
): boolean {
  return (
    occurrence.endsAt.getTime() > window.from.getTime() &&
    occurrence.startsAt.getTime() < window.to.getTime()
  );
}

/** WEEKLY without BYDAY repeats on the start's own weekday. */
function normalizeWeekdays(
  rule: RecurrenceRule,
  startLocal: WallClock,
): number[] {
  if (rule.frequency !== 'weekly') return [];
  const requested = rule.byWeekday.filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  if (requested.length === 0) {
    return [new Date(asUtcMs(startLocal)).getUTCDay()];
  }
  return [...new Set(requested)].sort((a, b) => a - b);
}

/**
 * The floating start(s) contained in period `n` of the series.
 *
 * Returns an array because a WEEKLY rule with BYDAY produces several per
 * period, and an empty array where the civil date does not exist.
 */
function periodCandidates(
  startLocal: WallClock,
  frequency: Frequency,
  interval: number,
  period: number,
  weekdays: number[],
): number[] {
  const startMs = asUtcMs(startLocal);
  switch (frequency) {
    case 'daily':
      return [startMs + period * interval * DAY_MS];
    case 'weekly': {
      // Anchored to the Sunday of the week containing the series start, so
      // "every second Tuesday and Thursday" keeps a stable fortnight parity.
      const weekStart =
        startMs -
        new Date(startMs).getUTCDay() * DAY_MS +
        period * interval * 7 * DAY_MS;
      return weekdays.map((d) => weekStart + d * DAY_MS);
    }
    case 'monthly': {
      const shifted = shiftCivil(startLocal, 0, period * interval);
      return shifted === null ? [] : [shifted];
    }
    case 'yearly': {
      const shifted = shiftCivil(startLocal, period * interval, 0);
      return shifted === null ? [] : [shifted];
    }
    case 'none':
      return period === 0 ? [startMs] : [];
  }
}

/**
 * Move a civil date by whole years/months, preserving day-of-month.
 *
 * Returns null when the result does not exist (31 January + 1 month, 29
 * February + 1 year). Clamping to the 28th instead would silently invent an
 * instance on a date the user never chose.
 */
function shiftCivil(
  startLocal: WallClock,
  years: number,
  months: number,
): number | null {
  const totalMonths = startLocal.month - 1 + months + years * 12;
  const year = startLocal.year + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12; // 0-11
  const candidate = Date.UTC(
    year,
    month,
    startLocal.day,
    startLocal.hour,
    startLocal.minute,
    startLocal.second,
  );
  // `Date.UTC` rolls 31 April over into 1 May rather than failing.
  return new Date(candidate).getUTCDate() === startLocal.day ? candidate : null;
}

/**
 * The first period index whose instance could reach `targetCivilMs`.
 *
 * Only used for open-ended series. A daily event created five years ago would
 * otherwise walk 1,800 periods on every nightly materialization to reach a
 * window 90 days wide. One period of slack is deducted so an instance that
 * began just before the window and is still running is not skipped.
 */
function firstPeriodNear(
  startLocal: WallClock,
  frequency: Frequency,
  interval: number,
  targetCivilMs: number,
): number {
  const startMs = asUtcMs(startLocal);
  if (targetCivilMs <= startMs) return 0;
  const elapsed = targetCivilMs - startMs;
  let period: number;
  switch (frequency) {
    case 'daily':
      period = Math.floor(elapsed / (interval * DAY_MS));
      break;
    case 'weekly':
      period = Math.floor(elapsed / (interval * 7 * DAY_MS));
      break;
    case 'monthly':
    case 'yearly': {
      const target = fromUtcMs(targetCivilMs);
      const months =
        (target.year - startLocal.year) * 12 +
        (target.month - startLocal.month);
      period = Math.floor(
        months / (frequency === 'yearly' ? 12 * interval : interval),
      );
      break;
    }
    case 'none':
      return 0;
  }
  return Math.max(0, period - 1);
}
