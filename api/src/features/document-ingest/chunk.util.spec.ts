import { chunkText } from './chunk.util';

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\t ')).toEqual([]);
  });

  it('returns a single chunk when the text fits', () => {
    expect(chunkText('short document', { size: 100 })).toEqual([
      { index: 0, text: 'short document' },
    ]);
  });

  it('indexes chunks in document order', () => {
    const chunks = chunkText('x'.repeat(1_000), { size: 100, overlap: 10 });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('never exceeds the requested size', () => {
    const chunks = chunkText('word '.repeat(2_000), { size: 300, overlap: 50 });
    for (const chunk of chunks)
      expect(chunk.text.length).toBeLessThanOrEqual(300);
  });

  it('prefers a paragraph break over a mid-sentence cut', () => {
    const text = `${'a'.repeat(150)}\n\n${'b'.repeat(150)}`;
    const [first] = chunkText(text, { size: 200, overlap: 0 });
    expect(first.text).toBe('a'.repeat(150));
  });

  // A fact spanning a boundary must stay findable from either side.
  it('overlaps consecutive chunks', () => {
    const chunks = chunkText('x'.repeat(1_000), { size: 200, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.map((c) => c.text).join('');
    expect(joined.length).toBeGreaterThan(1_000);
  });

  it('covers the whole document', () => {
    const text = Array.from({ length: 200 }, (_, i) => `sentence ${i}.`).join(
      ' ',
    );
    const chunks = chunkText(text, { size: 200, overlap: 20 });
    expect(chunks.at(-1)?.text).toContain('sentence 199.');
    expect(chunks[0].text).toContain('sentence 0.');
  });

  // A pathological input must not spin: the boundary search can legitimately
  // land on the window start.
  it('terminates on text with no usable boundaries', () => {
    const chunks = chunkText('x'.repeat(5_000), { size: 100, overlap: 99 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(6_000);
  });

  it('rejects a nonsensical configuration', () => {
    expect(() => chunkText('abc', { size: 0 })).toThrow(
      /size must be positive/,
    );
    expect(() => chunkText('abc', { size: 10, overlap: 10 })).toThrow(
      /overlap must be/,
    );
  });
});
