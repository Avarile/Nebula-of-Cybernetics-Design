import { passwordResetCodes } from './password-reset.schema';

describe('password-reset schema', () => {
  it('defines the password_reset_codes table with the expected columns', () => {
    expect(passwordResetCodes).toBeDefined();
    const cols = Object.keys(passwordResetCodes as any);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'createdAt',
        'userId',
        'codeHash',
        'expiresAt',
        'attemptCount',
        'consumedAt',
      ]),
    );
  });
});
