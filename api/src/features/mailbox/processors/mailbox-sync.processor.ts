import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { MailboxIngestService } from '../mailbox-ingest.service';
import {
  MAILBOX_SYNC_QUEUE,
  RECONCILE_MAILBOX_JOB,
  SYNC_JOB_OPTS,
  SYNC_MAILBOX_JOB,
} from '../mailbox.constants';
import { haltWorkerIfApiOnly } from '../../../infrastructure/queue/worker-role';

interface SyncJobData {
  accountId: string;
  mailbox: string;
}

/**
 * Consumes the `mailbox-sync` queue:
 *  - sync-mailbox:      ingest one batch, then continue if the batch was full.
 *  - reconcile-mailbox: re-index recent stored messages whose Meili document
 *                       may be missing/stale (best-effort, idempotent).
 */
@Processor(MAILBOX_SYNC_QUEUE)
export class MailboxSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MailboxSyncProcessor.name);

  constructor(
    private readonly ingest: MailboxIngestService,
    @InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SYNC_MAILBOX_JOB: {
        const { accountId, mailbox } = job.data as SyncJobData;
        const { processed, batchWasFull } = await this.ingest.sync(
          accountId,
          mailbox,
        );
        this.logger.log(
          `Synced ${processed} message(s) for ${accountId}/${mailbox}${batchWasFull ? ' (continuing)' : ''}`,
        );
        if (batchWasFull) {
          await this.queue.add(
            SYNC_MAILBOX_JOB,
            { accountId, mailbox },
            SYNC_JOB_OPTS,
          );
        }
        break;
      }
      case RECONCILE_MAILBOX_JOB: {
        const { accountId, mailbox } = job.data as SyncJobData;
        const { reindexed } = await this.ingest.reconcile(accountId, mailbox);
        this.logger.log(
          `Reconciled ${accountId}/${mailbox}: reindexed ${reindexed} message(s)`,
        );
        break;
      }
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }
}
