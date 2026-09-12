import { NoActiveEmailConfigError } from './email.types';

describe('email.types', () => {
  it('NoActiveEmailConfigError names the missing config kind', () => {
    const err = new NoActiveEmailConfigError('SMTP');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NoActiveEmailConfigError');
    expect(err.message).toContain('SMTP');
  });
});
