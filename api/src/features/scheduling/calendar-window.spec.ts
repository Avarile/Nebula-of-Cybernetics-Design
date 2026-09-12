import { localMonthToUtc, localWindowToUtc } from './calendar-window';

const MELBOURNE = 'Australia/Melbourne';

describe('calendar window', () => {
  it('starts a local month before the UTC month does', () => {
    // The bug this file exists to prevent: `09:00 1 September` in Melbourne is
    // `23:00 31 August` UTC, so a naive "September" query drops it.
    const { from, to } = localMonthToUtc(2025, 9, MELBOURNE);
    expect(from.toISOString()).toBe('2025-08-31T14:00:00.000Z');
    expect(to.toISOString()).toBe('2025-09-30T14:00:00.000Z');

    const firstMorning = new Date('2025-08-31T23:00:00Z'); // 09:00 on 1 Sep
    expect(firstMorning >= from && firstMorning < to).toBe(true);
    // ...and would have been missed by the naive bounds.
    expect(firstMorning >= new Date('2025-09-01T00:00:00Z')).toBe(false);
  });

  it('treats a bare date as local midnight', () => {
    const { from } = localWindowToUtc('2025-09-01', '2025-09-02', MELBOURNE);
    expect(from.toISOString()).toBe('2025-08-31T14:00:00.000Z');
  });

  it('accepts an explicit local time', () => {
    const { from } = localWindowToUtc(
      '2025-09-01 09:00',
      '2025-09-01 17:00',
      MELBOURNE,
    );
    expect(from.toISOString()).toBe('2025-08-31T23:00:00.000Z');
  });

  it('rolls a December month into the next year', () => {
    const { to } = localMonthToUtc(2025, 12, MELBOURNE);
    expect(to.toISOString()).toBe('2025-12-31T13:00:00.000Z');
  });

  it('refuses an unknown zone and an inverted range', () => {
    expect(() =>
      localWindowToUtc('2025-09-01', '2025-09-02', 'Nowhere/Here'),
    ).toThrow(/Unknown IANA time zone/);
    expect(() =>
      localWindowToUtc('2025-09-02', '2025-09-01', MELBOURNE),
    ).toThrow(/must be after/);
  });
});
