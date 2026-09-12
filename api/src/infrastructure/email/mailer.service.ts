import { Injectable } from '@nestjs/common';
import { EmailConfigRepository } from './email-config.repository';
import { NoActiveEmailConfigError, type EmailMessage } from './email.types';
import { sendMail, verifySmtp } from './transport/smtp.transport';

/** The single outbound-mail seam for the app. Sends via the active SMTP config. */
@Injectable()
export class MailerService {
  constructor(private readonly config: EmailConfigRepository) {}

  async send(msg: EmailMessage): Promise<void> {
    const conn = await this.config.activeSmtp();
    if (!conn) throw new NoActiveEmailConfigError('SMTP');
    await sendMail(conn, msg);
  }

  async verifyActive(): Promise<void> {
    const conn = await this.config.activeSmtp();
    if (!conn) throw new NoActiveEmailConfigError('SMTP');
    await verifySmtp(conn);
  }
}
