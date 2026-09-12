import { BullModule } from '@nestjs/bullmq';
import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { EmailModule } from '../../infrastructure/email/email.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { RetentionPurgeRegistry } from '../../infrastructure/retention/retention.registry';
import { RetentionRegistryModule } from '../../infrastructure/retention/retention-registry.module';
import { UsersModule } from '../users/users.module';
import {
  NotificationAdminController,
  NotificationController,
} from './notification.controller';
import { NotificationAdminService } from './notification-admin.service';
import { NOTIFICATION_QUEUE } from './notification.constants';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import {
  NotificationProcessor,
  NotificationScheduler,
} from './processors/notification.processor';

/**
 * Email notifications: the outbox, its drain, templates, preferences and the
 * suppression list.
 *
 * Registers its own retention purges — the sweep must never import the modules
 * whose rows it deletes.
 */
@Module({
  imports: [
    UsersModule,
    EmailModule,
    QueueModule,
    RetentionRegistryModule,
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController, NotificationAdminController],
  providers: [
    NotificationRepository,
    NotificationService,
    NotificationAdminService,
    NotificationScheduler,
    NotificationProcessor,
  ],
  exports: [NotificationService, NotificationAdminService],
})
export class NotificationsModule implements OnApplicationBootstrap {
  constructor(
    private readonly retention: RetentionPurgeRegistry,
    private readonly repo: NotificationRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.retention.register('notifications', (cutoff, limit) =>
      this.repo.purgeOlderThan(cutoff, limit),
    );
    this.retention.register('notification_delivery_attempts', (cutoff, limit) =>
      this.repo.purgeAttemptsOlderThan(cutoff, limit),
    );
  }
}
