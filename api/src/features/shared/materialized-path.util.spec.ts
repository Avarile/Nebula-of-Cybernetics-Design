import {
  childPath,
  rewriteDepth,
  rewritePath,
  wouldCycle,
} from './materialized-path.util';

describe('materialized path helpers', () => {
  describe('childPath', () => {
    it('roots a top-level node', () => {
      expect(childPath(null, 'manufacturing')).toBe('/manufacturing');
    });

    it('nests under a parent', () => {
      expect(childPath('/manufacturing', 'automotive')).toBe(
        '/manufacturing/automotive',
      );
    });
  });

  describe('wouldCycle', () => {
    it('rejects moving a node under its own descendant', () => {
      expect(wouldCycle('/a', '/a/b/c')).toBe(true);
    });

    it('rejects moving a node under itself', () => {
      expect(wouldCycle('/a', '/a')).toBe(true);
    });

    it('allows a move to an unrelated branch', () => {
      expect(wouldCycle('/a', '/b')).toBe(false);
    });

    it('is not fooled by a shared name prefix', () => {
      // `/ab` is not inside `/a`, however similar the strings look.
      expect(wouldCycle('/a', '/ab')).toBe(false);
    });
  });

  describe('rewritePath', () => {
    it('re-roots a descendant', () => {
      expect(rewritePath('/a/b/c', '/a', '/x/a')).toBe('/x/a/b/c');
    });

    it('leaves an unrelated path alone', () => {
      expect(rewritePath('/z/b', '/a', '/x/a')).toBe('/z/b');
    });

    it('handles the moving node itself', () => {
      expect(rewritePath('/a', '/a', '/x/a')).toBe('/x/a');
    });
  });

  describe('rewriteDepth', () => {
    it('shifts a descendant by the same amount as its root', () => {
      // /a (0) -> /x/a (1); its grandchild at depth 2 becomes 3.
      expect(rewriteDepth(2, 0, 1)).toBe(3);
    });

    it('handles a move towards the root', () => {
      expect(rewriteDepth(3, 2, 0)).toBe(1);
    });
  });
});
