import {
  addWallClockMinutes,
  formatWallClock,
  fromWallClock,
  isValidTimeZone,
  parseWallClock,
  toWallClock,
  zoneOffsetMs,
} from './timezone';

const MELBOURNE = 'Australia/Melbourne';
const NEW_YORK = 'America/New_York';

describe('timezone', () => {
  it('reads an instant as local parts', () => {
    const wall = toWallClock(new Date('2025-06-01T23:00:00Z'), MELBOURNE);
    expect(wall).toEqual({
      year: 2025,
      month: 6,
      day: 2,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it('formats midnight as hour 0, not hour 24', () => {
    // With the default hour cycle, midnight renders as `24` of the PREVIOUS
    // day and every date derived from it is a day out.
    const wall = toWallClock(new Date('2025-06-01T14:00:00Z'), MELBOURNE);
    expect(wall.hour).toBe(0);
    expect(wall.day).toBe(2);
  });

  it('reports the offset in force at an instant', () => {
    expect(zoneOffsetMs(new Date('2025-06-01T00:00:00Z'), MELBOURNE)).toBe(
      10 * 3_600_000,
    );
    expect(zoneOffsetMs(new Date('2025-12-01T00:00:00Z'), MELBOURNE)).toBe(
      11 * 3_600_000,
    );
  });

  it('round-trips an unambiguous wall clock', () => {
    const wall = parseWallClock('2025-06-02 09:00:00');
    const instant = fromWallClock(wall, MELBOURNE);
    expect(instant.toISOString()).toBe('2025-06-01T23:00:00.000Z');
    expect(toWallClock(instant, MELBOURNE)).toEqual(wall);
  });

  it('resolves a repeated wall clock to the first of the two', () => {
    // 2025-11-02 01:30 happens twice in New York: once at -04:00, again at
    // -05:00. A 01:30 reminder should fire the first time 01:30 comes round.
    const instant = fromWallClock(parseWallClock('2025-11-02 01:30'), NEW_YORK);
    expect(instant.toISOString()).toBe('2025-11-02T05:30:00.000Z');
  });

  it('resolves a nonexistent wall clock to just after the gap', () => {
    // Melbourne skips 02:00-03:00 on 2025-10-05, so 02:30 never happens.
    // Dropping the occurrence would make an event vanish once a year with no
    // error anywhere; shifting past the gap keeps it.
    const instant = fromWallClock(
      parseWallClock('2025-10-05 02:30'),
      MELBOURNE,
    );
    expect(toWallClock(instant, MELBOURNE)).toMatchObject({
      day: 5,
      hour: 3,
      minute: 30,
    });
  });

  it('parses what Postgres returns for a naive timestamp', () => {
    expect(parseWallClock('2025-10-05 02:30:00')).toEqual({
      year: 2025,
      month: 10,
      day: 5,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(parseWallClock('2025-10-05T02:30')).toMatchObject({ minute: 30 });
    expect(parseWallClock('2025-10-05 02:30:00.123')).toMatchObject({
      second: 0,
    });
    expect(() => parseWallClock('05/10/2025')).toThrow(/Invalid wall-clock/);
  });

  it('formats for Postgres', () => {
    expect(formatWallClock(parseWallClock('2025-01-02T03:04:05'))).toBe(
      '2025-01-02 03:04:05',
    );
  });

  it('adds wall-clock minutes without touching the zone', () => {
    // 90 minutes after 09:00 is 10:30, on both sides of a DST boundary.
    const wall = addWallClockMinutes(parseWallClock('2025-10-05 09:00'), 90);
    expect(formatWallClock(wall)).toBe('2025-10-05 10:30:00');
  });

  it('rejects an unknown zone', () => {
    expect(isValidTimeZone(MELBOURNE)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
