import { localWindowToUtc } from './calendar-window';
import { expandSeries, type SeriesDefinition } from './recurrence';
import { formatWallClock, parseWallClock, toWallClock } from './timezone';

const MELBOURNE = 'Australia/Melbourne';
const NEW_YORK = 'America/New_York';

function series(over: Partial<SeriesDefinition> = {}): SeriesDefinition {
  return {
    startLocal: parseWallClock('2025-10-01 09:00:00'),
    durationMinutes: 60,
    timeZone: MELBOURNE,
    rule: {
      frequency: 'daily',
      interval: 1,
      byWeekday: [],
      count: null,
      untilLocal: null,
    },
    ...over,
  };
}

/**
 * Windows are expressed as LOCAL dates, then converted — the same thing the
 * controller does. Writing them as UTC instants is how the first day of a
 * month goes missing, and the first draft of this file did exactly that.
 */
const window = (from: string, to: string, timeZone = MELBOURNE) =>
  localWindowToUtc(from, to, timeZone);

describe('expandSeries', () => {
  describe('DST', () => {
    it('holds the wall clock across a southern-hemisphere DST start', () => {
      // Melbourne moves +10:00 -> +11:00 at 02:00 on 2025-10-05.
      const out = expandSeries(series(), window('2025-10-03', '2025-10-08'));
      const locals = out.map((o) => formatWallClock(o.startLocal));
      expect(locals.every((l) => l.endsWith('09:00:00'))).toBe(true);

      const before = out.find((o) => o.startLocal.day === 4)!;
      const after = out.find((o) => o.startLocal.day === 6)!;
      // Same reading on the wall, an hour apart in UTC. That is the point.
      expect(before.startsAt.toISOString()).toBe('2025-10-03T23:00:00.000Z');
      expect(after.startsAt.toISOString()).toBe('2025-10-05T22:00:00.000Z');
    });

    it('holds the wall clock across a northern DST end', () => {
      // New York moves -04:00 -> -05:00 at 02:00 on 2025-11-02.
      const out = expandSeries(
        series({
          startLocal: parseWallClock('2025-10-30 09:00:00'),
          timeZone: NEW_YORK,
        }),
        window('2025-10-30', '2025-11-05', NEW_YORK),
      );
      const before = out.find((o) => o.startLocal.day === 1)!;
      const after = out.find((o) => o.startLocal.day === 3)!;
      expect(before.startsAt.toISOString()).toBe('2025-11-01T13:00:00.000Z');
      expect(after.startsAt.toISOString()).toBe('2025-11-03T14:00:00.000Z');
      expect(formatWallClock(after.startLocal)).toBe('2025-11-03 09:00:00');
    });

    it('proves the naive approach drifts, so the fix stays load-bearing', () => {
      // Expanding in UTC — "the next one is 24 hours later" — is the obvious
      // implementation and it is wrong twice a year. If this ever stops
      // failing, DST has been removed from the world and this file can go.
      const out = expandSeries(series(), window('2025-10-03', '2025-10-08'));
      const beforeTransition = out.find((o) => o.startLocal.day === 4)!;
      const naiveNextDay = new Date(
        beforeTransition.startsAt.getTime() + 86_400_000,
      );
      expect(toWallClock(naiveNextDay, MELBOURNE).hour).toBe(10);

      const actualNextDay = out.find((o) => o.startLocal.day === 5)!;
      expect(toWallClock(actualNextDay.startsAt, MELBOURNE).hour).toBe(9);
    });

    it('moves an occurrence out of a spring-forward gap rather than dropping it', () => {
      // 02:30 does not exist on 2025-10-05 in Melbourne.
      const out = expandSeries(
        series({ startLocal: parseWallClock('2025-10-04 02:30:00') }),
        window('2025-10-04', '2025-10-07'),
      );
      const gapDay = out.find((o) => o.startLocal.day === 5)!;
      expect(gapDay).toBeDefined();
      expect(toWallClock(gapDay.startsAt, MELBOURNE)).toMatchObject({
        day: 5,
        hour: 3,
        minute: 30,
      });
    });

    it('keeps duration in wall-clock minutes across a transition', () => {
      // A 09:00-10:00 meeting is still 09:00-10:00 on the day the clocks move,
      // even though the day itself is 23 hours long.
      const out = expandSeries(series(), window('2025-10-05', '2025-10-06'));
      expect(formatWallClock(out[0].endLocal)).toBe('2025-10-05 10:00:00');
    });
  });

  describe('frequencies', () => {
    it('expands a one-off event only when the window overlaps it', () => {
      const one = series({
        rule: {
          frequency: 'none',
          interval: 1,
          byWeekday: [],
          count: null,
          untilLocal: null,
        },
      });
      expect(
        expandSeries(one, window('2025-09-30', '2025-10-02')),
      ).toHaveLength(1);
      expect(
        expandSeries(one, window('2025-10-02', '2025-10-04')),
      ).toHaveLength(0);
    });

    it('honours an interval', () => {
      const out = expandSeries(
        series({
          rule: {
            frequency: 'daily',
            interval: 3,
            byWeekday: [],
            count: null,
            untilLocal: null,
          },
        }),
        window('2025-10-01', '2025-10-11'),
      );
      expect(out.map((o) => o.startLocal.day)).toEqual([1, 4, 7, 10]);
    });

    it('expands a weekly rule on several weekdays', () => {
      // 2025-10-01 is a Wednesday. Tue(2) + Thu(4), fortnightly.
      const out = expandSeries(
        series({
          rule: {
            frequency: 'weekly',
            interval: 2,
            byWeekday: [2, 4],
            count: null,
            untilLocal: null,
          },
        }),
        window('2025-10-01', '2025-10-31'),
      );
      // The first block is the week containing the start, so its Tuesday (the
      // 30th of September) falls before the series begins and is skipped.
      expect(
        out.map((o) => `${o.startLocal.month}-${o.startLocal.day}`),
      ).toEqual(['10-2', '10-14', '10-16', '10-28', '10-30']);
    });

    it('defaults a weekly rule to the start weekday', () => {
      const out = expandSeries(
        series({
          rule: {
            frequency: 'weekly',
            interval: 1,
            byWeekday: [],
            count: null,
            untilLocal: null,
          },
        }),
        window('2025-10-01', '2025-10-23'),
      );
      expect(out.map((o) => o.startLocal.day)).toEqual([1, 8, 15, 22]);
    });

    it('skips months that have no such day rather than clamping', () => {
      // Clamping the 31st to the 28th would invent an instance on a date the
      // user never chose.
      const out = expandSeries(
        series({
          startLocal: parseWallClock('2025-01-31 09:00:00'),
          rule: {
            frequency: 'monthly',
            interval: 1,
            byWeekday: [],
            count: null,
            untilLocal: null,
          },
        }),
        window('2025-01-01', '2025-06-01'),
      );
      expect(out.map((o) => o.startLocal.month)).toEqual([1, 3, 5]);
    });

    it('skips 29 February in common years', () => {
      const out = expandSeries(
        series({
          startLocal: parseWallClock('2024-02-29 09:00:00'),
          rule: {
            frequency: 'yearly',
            interval: 1,
            byWeekday: [],
            count: null,
            untilLocal: null,
          },
        }),
        window('2024-01-01', '2029-01-01'),
      );
      expect(out.map((o) => o.startLocal.year)).toEqual([2024, 2028]);
    });
  });

  describe('bounds', () => {
    it('stops after COUNT instances, counted from the series start', () => {
      const out = expandSeries(
        series({
          rule: {
            frequency: 'daily',
            interval: 1,
            byWeekday: [],
            count: 3,
            untilLocal: null,
          },
        }),
        window('2025-10-01', '2025-11-01'),
      );
      expect(out.map((o) => o.startLocal.day)).toEqual([1, 2, 3]);
    });

    it('counts instances that fall outside the window', () => {
      // COUNT is a property of the series, not of the page being read. Counting
      // only what the window shows would make a later window repeat them.
      const out = expandSeries(
        series({
          rule: {
            frequency: 'daily',
            interval: 1,
            byWeekday: [],
            count: 3,
            untilLocal: null,
          },
        }),
        window('2025-10-03', '2025-11-01'),
      );
      expect(out.map((o) => o.startLocal.day)).toEqual([3]);
    });

    it('honours an inclusive UNTIL', () => {
      const out = expandSeries(
        series({
          rule: {
            frequency: 'daily',
            interval: 1,
            byWeekday: [],
            count: null,
            untilLocal: parseWallClock('2025-10-03 09:00:00'),
          },
        }),
        window('2025-10-01', '2025-11-01'),
      );
      expect(out.map((o) => o.startLocal.day)).toEqual([1, 2, 3]);
    });

    it('skips ahead to the window for an open-ended series', () => {
      // A daily event created years ago must not walk every period to reach a
      // 90-day window — but must still land on exactly the right days.
      const out = expandSeries(
        series({ startLocal: parseWallClock('2015-03-01 09:00:00') }),
        window('2025-10-01', '2025-10-05'),
      );
      expect(out.map((o) => formatWallClock(o.startLocal))).toEqual([
        '2025-10-01 09:00:00',
        '2025-10-02 09:00:00',
        '2025-10-03 09:00:00',
        '2025-10-04 09:00:00',
      ]);
    });

    it('caps how much one call returns', () => {
      const out = expandSeries(series(), window('2025-01-01', '2035-01-01'), 5);
      expect(out).toHaveLength(5);
    });

    it('includes an instance already in progress at the window start', () => {
      // Overlap, not containment: a meeting that began an hour ago is still on
      // the calendar you are looking at.
      const out = expandSeries(
        series({ durationMinutes: 180 }),
        window('2025-10-01 10:00', '2025-10-01 11:00'),
      );
      expect(out).toHaveLength(1);
      expect(formatWallClock(out[0].startLocal)).toBe('2025-10-01 09:00:00');
    });
  });

  it('gives every instance an original start equal to its rule start', () => {
    // RECURRENCE-ID at expansion time. A later move rewrites `startsAt` only.
    const out = expandSeries(series(), window('2025-10-01', '2025-10-05'));
    for (const occurrence of out) {
      expect(occurrence.originalStart).toEqual(occurrence.startsAt);
    }
  });
});
