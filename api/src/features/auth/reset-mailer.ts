import { Injectable } from '@nestjs/common';
import { MailerService } from '../../infrastructure/email/mailer.service';

/** Password-reset email templates. Delegates delivery to MailerService. */
@Injectable()
export class ResetMailer {
  constructor(private readonly mailer: MailerService) {}

  async sendCode(email: string, code: string): Promise<void> {
    const subject = 'Your password reset code';
    const text =
      `Your password reset code is ${code}. It expires in 15 minutes.\n\n` +
      `If you didn't request this, you can safely ignore this email.`;
    const html =
      `<p>Your password reset code is <strong>${code}</strong>.</p>` +
      `<p>It expires in 15 minutes.</p>` +
      `<p>If you didn't request this, you can safely ignore this email.</p>`;
    await this.mailer.send({ to: email, subject, text, html });
  }

  async sendChangedConfirmation(email: string): Promise<void> {
    const subject = 'Your password was changed';
    const text =
      `Your password was just changed.\n\n` +
      `If this wasn't you, contact support immediately.`;
    const html =
      `<p>Your password was just changed.</p>` +
      `<p>If this wasn't you, contact support immediately.</p>`;
    await this.mailer.send({ to: email, subject, text, html });
  }
}
