import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SystemConfig } from '../../config/configurations/system.config';

/**
 * Reversible secret encryption at rest (AES-256-GCM). The counterpart to the
 * one-way TokenService.hashToken: values encrypted here (SMTP/IMAP passwords,
 * integration tokens) must be decryptable to be used.
 *
 * Envelope (single self-describing string): `v{version}.{iv}.{tag}.{ciphertext}`
 * with each binary part base64-encoded. The version prefix leaves room for key
 * rotation without a schema change (v1 ships a single key).
 */
@Injectable()
export class EncryptionService {
  /** version → key. Writes always use `version`; reads accept any known key. */
  private readonly keys = new Map<number, Buffer>();
  private readonly version: number;

  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<SystemConfig>('system');
    this.version = cfg.encryptionKeyVersion;
    this.keys.set(
      this.version,
      decodeKey(cfg.encryptionKey, 'SYSTEM_ENCRYPTION_KEY'),
    );

    // Retired keys, so a rotation can decrypt what the previous key wrote.
    // Without this the `v{n}` envelope prefix advertised a capability that did
    // not exist: `decrypt` always used the current key, so rotating
    // SYSTEM_ENCRYPTION_KEY made every stored secret permanently unreadable.
    for (const [version, encoded] of Object.entries(
      cfg.previousEncryptionKeys,
    )) {
      const parsed = Number(version);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `SYSTEM_ENCRYPTION_KEYS_PREVIOUS has a non-numeric version "${version}".`,
        );
      }
      if (this.keys.has(parsed)) {
        throw new Error(
          `SYSTEM_ENCRYPTION_KEYS_PREVIOUS re-declares version ${parsed}, which is the current key.`,
        );
      }
      this.keys.set(
        parsed,
        decodeKey(encoded, `SYSTEM_ENCRYPTION_KEYS_PREVIOUS[${parsed}]`),
      );
    }
  }

  /** Versions this service can decrypt. Ascending, for diagnostics. */
  knownVersions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }

  private currentKey(): Buffer {
    return this.keys.get(this.version) as Buffer;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.currentKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      `v${this.version}`,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 4 || !parts[0].startsWith('v')) {
      throw new Error('Malformed encryption envelope.');
    }
    const [versionTag, ivB64, tagB64, ctB64] = parts;
    // The version prefix is finally load-bearing: it selects the key that wrote
    // this envelope rather than assuming it was the current one.
    const version = Number(versionTag.slice(1));
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(
        `No encryption key for envelope version ${versionTag}; ` +
          `known versions: ${this.knownVersions().join(', ') || 'none'}.`,
      );
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Decode and length-check a base64 AES-256 key. */
function decodeKey(encoded: string, label: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error(`${label} must decode to 32 bytes (AES-256).`);
  }
  return key;
}
