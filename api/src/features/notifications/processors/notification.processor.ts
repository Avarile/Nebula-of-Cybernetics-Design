import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { MailerService } from '../../../infrastructure/email/mailer.service';
import {
  haltWorkerIfApiOnly,
  workersEnabled,
} from '../../../infrastructure/queue/worker-role';
import type { NotificationRow } from '../../../infrastructure/database/schema/notification.schema';
import { NotificationRepository } from '../notification.repository';
import {
  MAX_SEND_ATTEMPTS,
  NOTIFICATION_BATCH,
  NOTIFICATION_EVERY_MS,
  NOTIFICATION_QUEUE,
  NOTIFICATION_SCHEDULER_ID,
  NOTIFICATION_SEND_JOB,
  retryDelayMs,
} from '../notification.constants';
import { render } from '../template-renderer';

/** Registers the repeatable drain of the notification outbox. */
@Injectable()
export class NotificationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(@InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!workersEnabled()) return;
    try {
      await this.queue.upsertJobScheduler(
        NOTIFICATION_SCHEDULER_ID,
        { every: NOTIFICATION_EVERY_MS },
        {
          name: NOTIFICATION_SEND_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log(
        `Registered notification drain (every ${NOTIFICATION_EVERY_MS}ms)`,
      );
    } catch (error) {
      this.logger.warn(
        `Notification drain registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Drains the outbox.
 *
 * Claims a batch with `FOR UPDATE SKIP LOCKED` so two workers never send the
 * same row, renders it, and hands it to `MailerService`. Every attempt is
 * recorded, which is what makes a relay problem diagnosable after the fact.
 *
 * A suppressed address records `suppressed`, never `failed`: a suppression is a
 * correct outcome, and conflating the two hides real failures in the metrics.
 */
@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly mailer: MailerService,
  ) {
    super();
  }

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  async process(): Promise<{
    sent: number;
    failed: number;
    suppressed: number;
  }> {
    const claimed = await this.repo.claimSendable(
      NOTIFICATION_BATCH,
      new Date(),
    );
    let sent = 0;
    let failed = 0;
    let suppressed = 0;

    for (const row of claimed) {
      const outcome = await this.deliver(row);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'suppressed') suppressed += 1;
      else failed += 1;
    }
    if (claimed.length > 0) {
      this.logger.log(
        `Notification drain: ${sent} sent, ${failed} failed, ${suppressed} suppressed`,
      );
    }
    return { sent, failed, suppressed };
  }

  private async deliver(
    row: NotificationRow,
  ): Promise<'sent' | 'failed' | 'suppressed'> {
    const attempt = row.attempts + 1;
    const startedAt = Date.now();

    // Re-checked at send time, not only at enqueue: an address can be
    // suppressed while a notification sits in the outbox.
    const suppression = await this.repo.findSuppression(
      row.recipientEmail,
      row.eventTypeId,
    );
    if (suppression) {
      await this.repo.markSuppressed(
        row.id,
        `suppressed: ${suppression.reason}`,
      );
      await this.repo.recordAttempt({
        notificationId: row.id,
        attemptNumber: attempt,
        status: 'suppressed',
        responseMessage: suppression.reason,
      });
      return 'suppressed';
    }

    try {
      const template = row.templateId
        ? await this.repo.findTemplate(row.subject, 'en')
        : null;
      const body = template
        ? render(template.bodyTextTemplate, row.payload).text
        : (row.bodyPreview ?? row.subject);
      const html = template?.bodyHtmlTemplate
        ? render(template.bodyHtmlTemplate, row.payload).text
        : undefined;

      await this.mailer.send({
        to: row.recipientEmail,
        subject: row.subject,
        text: body,
        html,
      });

      await this.repo.markSent(row.id, null);
      await this.repo.recordAttempt({
        notificationId: row.id,
        attemptNumber: attempt,
        status: 'sent',
        durationMs: Date.now() - startedAt,
      });
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Exponential backoff while retries remain, mirroring the search indexer.
      const retryAt =
        attempt < MAX_SEND_ATTEMPTS
          ? new Date(Date.now() + retryDelayMs(attempt))
          : null;
      await this.repo.markFailed(row.id, message, attempt, retryAt);
      await this.repo.recordAttempt({
        notificationId: row.id,
        attemptNumber: attempt,
        status: retryAt ? 'pending' : 'failed',
        responseMessage: message.slice(0, 1000),
        durationMs: Date.now() - startedAt,
      });
      if (!retryAt) {
        this.logger.error(
          `Notification ${row.id} abandoned after ${attempt} attempts: ${message}`,
        );
      }
      return 'failed';
    }
  }
}
