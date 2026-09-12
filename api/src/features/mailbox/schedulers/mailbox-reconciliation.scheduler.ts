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
  RECONCILE_EVERY_MS,
  RECONCILE_MAILBOX_JOB,
} from '../mailbox.constants';
import { ImapConfigRepository } from '../../system/imap-config.repository';
import { workersEnabled } from '../../../infrastructure/queue/worker-role';

/**
 * Registers the repeatable reconciliation sweep on startup (best-effort so
 * boot never hard-requires Redis; mirrors MailboxSyncScheduler). Runs on the
 * same queue as sync, via a distinct job name handled by the existing
 * MailboxSyncProcessor. Uses `queue.upsertJobScheduler` keyed by a stable
 * scheduler id, which is idempotent — re-registering on every boot updates
 * the existing scheduler in place instead of orphaning a stale repeatable in
 * Redis.
 */
@Injectable()
export class MailboxReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxReconciliationScheduler.name);
  private readonly cfg: MailboxConfig;

  constructor(
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
    private readonly accounts: ImapConfigRepository,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    // Every live IMAP account, not just the configured default. `accountId` is
    // now the `imap_configs.id`, so enumerating the configs enumerates the
    // mailboxes that actually exist — previously a second account could be
    // synced through the API but was never reconciled.
    const accounts = await this.accounts.listLiveIds();
    if (accounts.length === 0) {
      this.logger.log('Mailbox reconciliation skipped (no IMAP accounts)');
      return;
    }
    try {
      for (const accountId of accounts) {
        await this.queue.upsertJobScheduler(
          `mailbox-reconcile:${accountId}:${this.cfg.mailbox}`,
          { every: RECONCILE_EVERY_MS },
          {
            name: RECONCILE_MAILBOX_JOB,
            data: { accountId, mailbox: this.cfg.mailbox },
            opts: { removeOnComplete: true, removeOnFail: true },
          },
        );
      }
      this.logger.log(
        `Registered mailbox reconciliation for ${accounts.length} account(s)`,
      );
    } catch (err) {
      this.logger.warn(
        `Mailbox reconciliation registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
