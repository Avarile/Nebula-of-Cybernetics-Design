import { TITLE_MAX, sanitizeTitle } from './conversation-title';

describe('sanitizeTitle', () => {
  it('passes a short single-line title through untouched', () => {
    expect(sanitizeTitle('Friendly Greeting from User')).toBe(
      'Friendly Greeting from User',
    );
  });

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(sanitizeTitle('It looks like\n\n  your test   message')).toBe(
      'It looks like your test message',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeTitle('  padded  ')).toBe('padded');
  });

  it('truncates an over-long title to TITLE_MAX chars including the ellipsis', () => {
    const out = sanitizeTitle('x'.repeat(200)) as string;
    expect(out).toHaveLength(TITLE_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not leave a dangling space before the ellipsis', () => {
    // 79 chars, then a space, then more — the cut lands right after the space.
    const out = sanitizeTitle(`${'a'.repeat(79)} tail words here`) as string;
    expect(out).toBe(`${'a'.repeat(79)}…`);
  });

  it('returns null for empty, whitespace-only, null and undefined input', () => {
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle('   \n  ')).toBeNull();
    expect(sanitizeTitle(null)).toBeNull();
    expect(sanitizeTitle(undefined)).toBeNull();
  });
});
