import { Module } from '@nestjs/common';
import { FileProcessorModule } from '../file-processor/file-processor.module';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { SharedModule } from './shared.module';

/**
 * Attachments, split out of `SharedModule` on purpose.
 *
 * `AttachmentService` needs `FileService` to authorize a file, and
 * `FileProcessorModule` needs MinIO and the BullMQ connection. Leaving it in
 * `SharedModule` made those transitive dependencies of everything that imports
 * shared — including `AuthorizationModule`, and through it `UsersModule` and
 * `AuthModule`. Authentication does not need object storage, and a module-subset
 * test context that only wanted to log a user in should not have to provide it.
 *
 * `AttachmentRepository` stays in `SharedModule` (it needs only the database) so
 * `EntityCascadeService` can still purge attachment rows.
 */
@Module({
  imports: [SharedModule, FileProcessorModule],
  controllers: [AttachmentController],
  providers: [AttachmentService],
  exports: [AttachmentService],
})
export class AttachmentsModule {}
