import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * A real argon2id hash of a value nobody knows, used to spend the same CPU on a
 * missing account as on a real one.
 *
 * Computed lazily and memoised rather than at module load: a top-level `await`
 * of a native hash starts work on import, which outlives short-lived Jest
 * workers and turns an unrelated suite into a teardown failure.
 */
let decoyHash: Promise<string> | undefined;

function decoy(): Promise<string> {
  decoyHash ??= argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  return decoyHash;
}

/** Password hashing/verification using argon2id (OWASP-recommended). */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  /**
   * Verify against a decoy hash, discarding the result.
   *
   * Argon2id is deliberately expensive, so skipping it when the account does
   * not exist made "unknown email" resolve an order of magnitude faster than
   * "wrong password" — a user-enumeration oracle measurable over the network.
   * `PasswordResetService` already equalised its HMAC timing this way
   * (`DECOY_CODE_HASH`); the login path did not.
   */
  async verifyDecoy(plain: string): Promise<void> {
    await argon2.verify(await decoy(), plain).catch(() => false);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
