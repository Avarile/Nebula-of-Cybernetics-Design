import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { MailboxConfig } from '../../../config/configurations/mailbox.config';
import {
  MAILBOX_SYNC_QUEUE,
  SYNC_JOB_OPTS,
  SYNC_MAILBOX_JOB,
} from '../mailbox.constants';
import { workersEnabled } from '../../../infrastructure/queue/worker-role';

/**
 * Registers the repeatable inbound-sync poll on startup (best-effort so boot
 * never hard-requires Redis; mirrors AgentScheduleScheduler). Uses
 * `queue.upsertJobScheduler` keyed by a stable scheduler id, which is
 * idempotent — re-registering on every boot (even with a changed
 * `pollIntervalMs`) updates the existing scheduler in place instead of
 * orphaning a stale repeatable in Redis. Also exposes `enqueueSync` for the
 * manual endpoint.
 */
@Injectable()
export class MailboxSyncScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxSyncScheduler.name);
  private readonly cfg: MailboxConfig;

  constructor(
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    if (!this.cfg.defaultAccountId) {
      this.logger.log(
        'Mailbox poll disabled (MAILBOX_DEFAULT_ACCOUNT_ID unset)',
      );
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        `mailbox-poll:${this.cfg.defaultAccountId}:${this.cfg.mailbox}`,
        { every: this.cfg.pollIntervalMs },
        {
          name: SYNC_MAILBOX_JOB,
          data: {
            accountId: this.cfg.defaultAccountId,
            mailbox: this.cfg.mailbox,
          },
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log('Registered mailbox sync poll');
    } catch (err) {
      this.logger.warn(
        `Mailbox poll registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async enqueueSync(accountId: string, mailbox: string): Promise<void> {
    await this.queue.add(
      SYNC_MAILBOX_JOB,
      { accountId, mailbox },
      SYNC_JOB_OPTS,
    );
  }
}
