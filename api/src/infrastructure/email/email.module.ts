import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { EmailConfigRepository } from './email-config.repository';
import { InboxService } from './inbox.service';
import { MailerService } from './mailer.service';

/**
 * Email infrastructure: outbound SMTP (MailerService) and inbound IMAP
 * (InboxService). Depends only on infrastructure (DatabaseModule is @Global;
 * CryptoModule provides EncryptionService). Imported explicitly by every
 * consumer so module-subset e2e boots stay self-sufficient.
 */
@Module({
  imports: [CryptoModule],
  providers: [EmailConfigRepository, MailerService, InboxService],
  exports: [MailerService, InboxService],
})
export class EmailModule {}
