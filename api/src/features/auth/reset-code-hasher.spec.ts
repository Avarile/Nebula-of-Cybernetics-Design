import { ResetCodeHasher } from './reset-code-hasher';

function makeHasher(pepper = 'test-pepper', codeLength = 6) {
  const config = {
    getOrThrow: () => ({ passwordReset: { pepper, codeLength } }),
  } as any;
  return new ResetCodeHasher(config);
}

describe('ResetCodeHasher', () => {
  it('generate returns a zero-padded 6-digit string', () => {
    const h = makeHasher();
    for (let i = 0; i < 50; i++) {
      const code = h.generate();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('hash is deterministic, hex, and not the plaintext', () => {
    const h = makeHasher();
    const a = h.hash('123456');
    const b = h.hash('123456');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('123456');
  });

  it('hash depends on the pepper', () => {
    expect(makeHasher('p1').hash('123456')).not.toBe(
      makeHasher('p2').hash('123456'),
    );
  });

  it('verify is true for the right code, false otherwise', () => {
    const h = makeHasher();
    const hash = h.hash('654321');
    expect(h.verify('654321', hash)).toBe(true);
    expect(h.verify('000000', hash)).toBe(false);
  });

  it('verify returns false (no throw) on a malformed stored hash', () => {
    const h = makeHasher();
    expect(h.verify('654321', 'not-hex')).toBe(false);
  });
});
