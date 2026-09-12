import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes then verifies a password', async () => {
    const hash = await svc.hash('s3cret-password-123');
    expect(hash).not.toBe('s3cret-password-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(hash, 's3cret-password-123')).toBe(true);
    expect(await svc.verify(hash, 'wrong-password')).toBe(false);
  });

  it('returns false on a malformed hash instead of throwing', async () => {
    expect(await svc.verify('not-a-real-hash', 'x')).toBe(false);
  });
});
