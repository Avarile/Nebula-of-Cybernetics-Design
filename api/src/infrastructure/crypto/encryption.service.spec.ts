import { EncryptionService } from './encryption.service';

/** ConfigService stub returning a fixed 32-byte key. */
function makeService(
  keyB64 = Buffer.alloc(32, 7).toString('base64'),
  version = 1,
) {
  const config = {
    getOrThrow: () => ({
      encryptionKey: keyB64,
      encryptionKeyVersion: version,
      previousEncryptionKeys: {},
    }),
  } as any;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const svc = makeService();
    const secret = 'sup3r-secret-smtp-password';
    const envelope = svc.encrypt(secret);
    expect(envelope).not.toContain(secret);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(svc.decrypt(envelope)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const svc = makeService();
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('throws when the ciphertext is tampered with', () => {
    const svc = makeService();
    const env = svc.encrypt('secret');
    const parts = env.split('.');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff; // flip a bit
    parts[3] = ct.toString('base64');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    const svc = makeService();
    expect(() => svc.decrypt('not-an-envelope')).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => makeService(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('EncryptionService key rotation', () => {
  const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
  const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

  const svc = (
    encryptionKey: string,
    encryptionKeyVersion: number,
    previousEncryptionKeys: Record<string, string> = {},
  ) =>
    new EncryptionService({
      getOrThrow: () => ({
        encryptionKey,
        encryptionKeyVersion,
        previousEncryptionKeys,
      }),
    } as never);

  it('stamps the current version into the envelope', () => {
    expect(svc(KEY_V2, 2).encrypt('secret').startsWith('v2.')).toBe(true);
  });

  /**
   * The whole point of the `v{n}` prefix, which previously did nothing:
   * `decrypt` always used the current key, so rotating the key made every
   * stored secret permanently unreadable.
   */
  it('decrypts a value written by a retired key', () => {
    const oldEnvelope = svc(KEY_V1, 1).encrypt('written under v1');
    const rotated = svc(KEY_V2, 2, { '1': KEY_V1 });
    expect(rotated.decrypt(oldEnvelope)).toBe('written under v1');
  });

  it('still decrypts values written by the current key', () => {
    const rotated = svc(KEY_V2, 2, { '1': KEY_V1 });
    expect(rotated.decrypt(rotated.encrypt('fresh'))).toBe('fresh');
  });

  it('refuses an envelope whose version it has no key for', () => {
    const oldEnvelope = svc(KEY_V1, 1).encrypt('orphan');
    // Rotated without carrying v1 forward — the failure a rotation would hit.
    expect(() => svc(KEY_V2, 2).decrypt(oldEnvelope)).toThrow(
      /No encryption key for envelope version v1/,
    );
  });

  it('reports which versions it can read', () => {
    expect(svc(KEY_V2, 2, { '1': KEY_V1 }).knownVersions()).toEqual([1, 2]);
  });

  it('rejects a retired key that is not 32 bytes', () => {
    expect(() => svc(KEY_V2, 2, { '1': 'dG9vLXNob3J0' })).toThrow(
      /must decode to 32 bytes/,
    );
  });

  it('rejects a retired entry that re-declares the current version', () => {
    expect(() => svc(KEY_V2, 2, { '2': KEY_V1 })).toThrow(/re-declares/);
  });
});
