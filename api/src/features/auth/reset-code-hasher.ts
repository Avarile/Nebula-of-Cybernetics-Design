import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../../config/configurations/auth.config';

/**
 * Generates + verifies the 6-digit reset code. The code is stored only as an
 * HMAC-SHA256 keyed with a server pepper, so a DB leak alone cannot brute the
 * low-entropy (10^6) code space. Verification is constant-time.
 */
@Injectable()
export class ResetCodeHasher {
  private readonly pepper: string;
  private readonly length: number;

  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<AuthConfig>('auth');
    this.pepper = cfg.passwordReset.pepper;
    this.length = cfg.passwordReset.codeLength;
  }

  generate(): string {
    const max = 10 ** this.length;
    return String(randomInt(0, max)).padStart(this.length, '0');
  }

  hash(code: string): string {
    return createHmac('sha256', this.pepper).update(code).digest('hex');
  }

  verify(code: string, hash: string): boolean {
    const expected = Buffer.from(this.hash(code), 'hex');
    let actual: Buffer;
    try {
      // Buffer.from(str, 'hex') never throws for a string input (it silently
      // truncates at the first invalid byte pair) — this only guards against
      // a non-string `hash` at runtime. The real defense against a
      // malformed/short hex string reaching timingSafeEqual (which throws on
      // a length mismatch) is the length check below.
      actual = Buffer.from(hash, 'hex');
    } catch {
      return false;
    }
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
