import { backoffMs, reminderDedupeKey } from './scheduling.constants';

describe('backoffMs', () => {
  const BASE = 30_000;
  const CAP = 1_800_000;

  it('grows exponentially with attempts', () => {
    // Upper bound of the jitter window, so the growth itself is observable.
    const at = (n: number) => backoffMs(n, BASE, CAP, () => 1);
    expect(at(1)).toBe(30_000);
    expect(at(2)).toBe(60_000);
    expect(at(3)).toBe(120_000);
  });

  it('caps the delay', () => {
    expect(backoffMs(20, BASE, CAP, () => 1)).toBe(CAP);
  });

  it('never returns the same delay for every caller', () => {
    // Full jitter: without it, a hundred jobs that failed against one
    // downstream retry in lockstep and hammer it as it recovers.
    const lowest = backoffMs(3, BASE, CAP, () => 0);
    const highest = backoffMs(3, BASE, CAP, () => 1);
    expect(lowest).toBe(60_000);
    expect(highest).toBe(120_000);
  });

  it('stays within half the exponential and all of it', () => {
    for (let i = 0; i < 200; i++) {
      const delay = backoffMs(4, BASE, CAP);
      expect(delay).toBeGreaterThanOrEqual(120_000);
      expect(delay).toBeLessThanOrEqual(240_000);
    }
  });

  it('treats attempt 0 as the first attempt', () => {
    expect(backoffMs(0, BASE, CAP, () => 1)).toBe(BASE);
  });
});

describe('reminderDedupeKey', () => {
  it('identifies a reminder by occurrence and offset', () => {
    // Re-expanding an unchanged event must insert nothing.
    expect(reminderDedupeKey('abc', 900_000)).toBe('event_reminder:abc:900000');
    expect(reminderDedupeKey('abc', 900_000)).toBe(
      reminderDedupeKey('abc', 900_000),
    );
    expect(reminderDedupeKey('abc', 0)).not.toBe(
      reminderDedupeKey('abc', 900_000),
    );
  });
});
