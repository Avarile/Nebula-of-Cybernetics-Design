import {
  evenlySpacedRanks,
  initialRank,
  needsRebalance,
  rankBetween,
} from './lexorank.util';

describe('lexorank', () => {
  it('produces a rank between two others', () => {
    const mid = rankBetween('a', 'c');
    expect(mid > 'a').toBe(true);
    expect(mid < 'c').toBe(true);
  });

  it('produces a rank before everything', () => {
    const first = rankBetween(null, 'b');
    expect(first < 'b').toBe(true);
  });

  it('produces a rank after everything', () => {
    const last = rankBetween('y', null);
    expect(last > 'y').toBe(true);
  });

  it('handles adjacent ranks by going deeper instead of failing', () => {
    // 'a' and 'b' have no character between them; the rank grows a character.
    const mid = rankBetween('a', 'b');
    expect(mid > 'a').toBe(true);
    expect(mid < 'b').toBe(true);
    expect(mid.length).toBeGreaterThan(1);
  });

  it('survives repeated insertion at the same point', () => {
    // The pathological case for any ordering scheme: always drop the new card
    // immediately after the first one.
    let lo = 'a';
    const hi = 'b';
    for (let i = 0; i < 50; i++) {
      const next = rankBetween(lo, hi);
      expect(next > lo).toBe(true);
      expect(next < hi).toBe(true);
      lo = next;
    }
  });

  it('keeps a whole reordered list sorted', () => {
    const ranks = [initialRank()];
    // Insert at the front, the back and the middle, then check the ordering
    // holds under a plain string sort — which is what Postgres will do.
    ranks.unshift(rankBetween(null, ranks[0]));
    ranks.push(rankBetween(ranks[ranks.length - 1], null));
    ranks.splice(1, 0, rankBetween(ranks[0], ranks[1]));
    expect([...ranks].sort()).toEqual(ranks);
  });

  it('rejects bounds in the wrong order, rather than silently misplacing', () => {
    expect(() => rankBetween('c', 'a')).toThrow(/before < after/);
    expect(() => rankBetween('a', 'a')).toThrow(/before < after/);
  });

  describe('rebalancing', () => {
    it('flags ranks that have grown long', () => {
      expect(needsRebalance(['a', 'aaaaaaaaaaaaaa'])).toBe(true);
      expect(needsRebalance(['a', 'b', 'c'])).toBe(false);
    });

    it('spaces a list evenly and in order', () => {
      const ranks = evenlySpacedRanks(5);
      expect(ranks).toHaveLength(5);
      expect([...ranks].sort()).toEqual(ranks);
    });

    it('returns nothing for an empty list', () => {
      expect(evenlySpacedRanks(0)).toEqual([]);
    });
  });
});

/**
 * `evenlySpacedRanks` at scale.
 *
 * The regression: `step = floor(36 / (count + 1))` with the index clamped to
 * `BASE - 1` saturated past 35 items, so every rank after the 35th was `'z'`.
 * Rebalancing a 40-card column would have collapsed its order into a tie. The
 * original spec only asked for five ranks, and the helper had no callers, so
 * nothing caught it until the rebalance sweep needed it.
 */
describe('evenlySpacedRanks at scale', () => {
  for (const count of [1, 5, 34, 35, 36, 40, 60, 200, 1300]) {
    it(`returns ${count} strictly ascending, unique ranks`, () => {
      const ranks = evenlySpacedRanks(count);
      expect(ranks).toHaveLength(count);
      expect(new Set(ranks).size).toBe(count);
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i - 1] < ranks[i]).toBe(true);
      }
    });
  }

  it('leaves room to insert above, below and between', () => {
    const ranks = evenlySpacedRanks(40);
    expect(rankBetween(null, ranks[0]) < ranks[0]).toBe(true);
    expect(rankBetween(ranks[ranks.length - 1], null) > ranks[39]).toBe(true);
    const mid = rankBetween(ranks[0], ranks[1]);
    expect(mid > ranks[0] && mid < ranks[1]).toBe(true);
  });

  it('produces ranks short enough that a rebalance is worth doing', () => {
    expect(needsRebalance(evenlySpacedRanks(1000))).toBe(false);
  });
});
