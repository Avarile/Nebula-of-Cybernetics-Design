import { slugify } from './slug.util';

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Engineering Runbooks')).toBe('engineering-runbooks');
  });

  it('collapses a run of punctuation into one dash', () => {
    expect(slugify('Q4 — Finance & Ops!')).toBe('q4-finance-ops');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  ...Ops...  ')).toBe('ops');
  });

  it('clips to maxLength', () => {
    expect(slugify('a'.repeat(80), 60)).toHaveLength(60);
  });

  it('leaves no trailing dash when the clip lands on a separator', () => {
    // `policies-and-procedures` cut at 9 would be `policies-`.
    expect(slugify('Policies And Procedures', 9)).toBe('policies');
  });

  it('falls back to `untitled` when nothing survives', () => {
    expect(slugify('★★★')).toBe('untitled');
  });

  it('never returns an empty string for a clip that removes everything', () => {
    expect(slugify('-a', 1)).toBe('a');
  });
});
