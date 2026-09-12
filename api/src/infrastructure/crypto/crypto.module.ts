import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/** Provides the reusable EncryptionService (reads the `system` config). */
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
