import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthConfig } from '../../config/configurations/auth.config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { UserRepository } from '../users/user.repository';
import { PasswordResetRepository } from './password-reset.repository';
import { PasswordService } from './password.service';
import { ResetCodeHasher } from './reset-code-hasher';
import { ResetMailer } from './reset-mailer';
import { SessionRevocationService } from './session-revocation.service';

/** A syntactically valid but unmatchable hash, for timing equalization. */
const DECOY_CODE_HASH = '0'.repeat(64);

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly users: UserRepository,
    private readonly codes: PasswordResetRepository,
    private readonly revocation: SessionRevocationService,
    private readonly passwords: PasswordService,
    private readonly hasher: ResetCodeHasher,
    private readonly mailer: ResetMailer,
    config: ConfigService,
    private readonly errors: ExceptionService,
  ) {
    const cfg = config.getOrThrow<AuthConfig>('auth');
    this.ttlMs = cfg.passwordReset.codeTtlSeconds * 1000;
    this.maxAttempts = cfg.passwordReset.maxAttempts;
  }

  /**
   * Issue a reset code and email it. Always resolves and never reveals whether
   * the account exists (enumeration-safe); mail delivery is best-effort.
   */
  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) {
      this.logger.log('forgot_requested email=unknown');
      return;
    }
    await this.codes.consumeAllForUser(user.id);
    const code = this.hasher.generate();
    await this.codes.insert({
      userId: user.id,
      codeHash: this.hasher.hash(code),
      expiresAt: new Date(Date.now() + this.ttlMs),
    });
    this.logger.log(`forgot_requested userId=${user.id}`);
    void this.mailer
      .sendCode(user.email, code)
      .catch((err) =>
        this.logger.error(
          `reset code email failed userId=${user.id}`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
  }

  /**
   * Verify the code and reset the password. Throws a uniform 401 on any
   * failure (unknown email, missing/expired/consumed code, wrong code,
   * attempts exhausted) — never revealing which factor failed.
   */
  async reset(email: string, code: string, newPassword: string): Promise<void> {
    const fail = () => this.errors.create(ErrorCode.AUTH_RESET_CODE_INVALID);

    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) {
      this.hasher.verify(code, DECOY_CODE_HASH); // equalize HMAC timing
      this.logger.warn('reset_failed reason=unknown_email');
      throw fail();
    }

    const row = await this.codes.findLiveByUser(user.id);
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      this.hasher.verify(code, DECOY_CODE_HASH);
      this.logger.warn(`reset_failed userId=${user.id} reason=no_live_code`);
      throw fail();
    }

    if (!this.hasher.verify(code, row.codeHash)) {
      const attempts = await this.codes.incrementAttempts(row.id);
      if (attempts >= this.maxAttempts) {
        await this.codes.consume(row.id);
        this.logger.warn(`reset_lockout userId=${user.id}`);
      } else {
        this.logger.warn(`reset_failed userId=${user.id} reason=wrong_code`);
      }
      throw fail();
    }

    await this.users.update(user.id, {
      passwordHash: await this.passwords.hash(newPassword),
    });
    await this.codes.consume(row.id);
    await this.revocation.revokeAllForUser(user.id);
    this.logger.log(`reset_succeeded userId=${user.id}`);
    try {
      await this.mailer.sendChangedConfirmation(user.email);
    } catch (err) {
      this.logger.error(
        `reset confirmation email failed userId=${user.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
