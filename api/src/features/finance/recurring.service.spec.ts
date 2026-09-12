import { nextOccurrence } from './recurring.service';

describe('nextOccurrence', () => {
  const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('advances weekly', () => {
    expect(iso(nextOccurrence(at('2026-01-01'), 'weekly'))).toBe('2026-01-08');
  });

  it('advances fortnightly', () => {
    expect(iso(nextOccurrence(at('2026-01-01'), 'fortnightly'))).toBe(
      '2026-01-15',
    );
  });

  it('advances monthly', () => {
    expect(iso(nextOccurrence(at('2026-01-15'), 'monthly'))).toBe('2026-02-15');
  });

  it('advances quarterly and yearly', () => {
    expect(iso(nextOccurrence(at('2026-01-15'), 'quarterly'))).toBe(
      '2026-04-15',
    );
    expect(iso(nextOccurrence(at('2026-01-15'), 'yearly'))).toBe('2027-01-15');
  });

  it('rolls a month-end date forward rather than dropping it', () => {
    // 31 January + 1 month has no 31 February; JavaScript rolls into March,
    // which keeps the schedule alive rather than silently skipping a period.
    const next = nextOccurrence(at('2026-01-31'), 'monthly');
    expect(next.getTime()).toBeGreaterThan(at('2026-01-31').getTime());
  });

  it('crosses a year boundary', () => {
    expect(iso(nextOccurrence(at('2026-12-15'), 'monthly'))).toBe('2027-01-15');
  });
});
