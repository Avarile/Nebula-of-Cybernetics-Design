import { authConfig } from './auth.config';

describe('authConfig.passwordReset', () => {
  it('exposes the reset policy with sane defaults', () => {
    const cfg = authConfig();
    expect(cfg.passwordReset).toEqual(
      expect.objectContaining({
        codeTtlSeconds: 900,
        maxAttempts: 5,
        codeLength: 6,
      }),
    );
    expect(typeof cfg.passwordReset.pepper).toBe('string');
    expect(cfg.passwordReset.pepper.length).toBeGreaterThan(0);
  });
});
