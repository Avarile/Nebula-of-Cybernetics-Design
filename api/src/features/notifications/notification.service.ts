import { Injectable, Logger } from '@nestjs/common';
import type { DrizzleExecutor } from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  NotificationRow,
  NotificationTemplateRow,
} from '../../infrastructure/database/schema/notification.schema';
import { ProfileService } from '../users/profile.service';
import { NotificationRepository } from './notification.repository';
import { render, validatePayload } from './template-renderer';

/** One resolved recipient. */
export interface Recipient {
  userId?: string | null;
  contactId?: string | null;
  email: string;
  locale?: string;
}

export interface EnqueueInput {
  /** A key from `notification_event_types`; unknown keys are refused. */
  eventKey: string;
  recipients: Recipient[];
  payload: Record<string, unknown>;
  entityType?: NotificationRow['entityType'];
  entityId?: string | null;
  projectId?: string | null;
  /** Idempotency key suffix; combined with the event key and recipient. */
  dedupeKey?: string;
  /** Collapse into one digest email with anything sharing this key. */
  digestGroupKey?: string;
  scheduledFor?: Date | null;
  priority?: NotificationRow['priority'];
}

/** Preview of the body kept on the row; full bodies are not persisted. */
const PREVIEW_CHARS = 1_000;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly profiles: ProfileService,
    private readonly errors: ExceptionService,
  ) {}

  /**
   * Write outbox rows for an event.
   *
   * **Pass the caller's transaction.** The row must commit with the change it
   * announces: enqueue inside the transaction and a rollback un-sends the mail,
   * enqueue after commit and a crash between the two loses it. This is the
   * pattern `search_records.index_state` already implements, reused rather than
   * reinvented.
   *
   * Applies, in order: the event catalog, each recipient's preference, and the
   * suppression list. A mandatory event skips preferences but never skips a
   * suppression.
   */
  async enqueue(
    input: EnqueueInput,
    executor?: DrizzleExecutor,
  ): Promise<NotificationRow[]> {
    const eventType = await this.repo.findEventType(input.eventKey);
    if (!eventType) {
      // A typo here would silently mail nobody; the boot assertion catches most
      // of these, and this catches the rest.
      throw this.errors.create(ErrorCode.VALIDATION_FAILED, {
        message: `Unknown notification event "${input.eventKey}"`,
      });
    }

    const userIds = input.recipients
      .map((r) => r.userId)
      .filter((id): id is string => Boolean(id));
    const preferences = await this.repo.preferencesFor(userIds, eventType.id);

    const rows: NotificationRow[] = [];
    const pending = [];

    for (const recipient of input.recipients) {
      if (!recipient.email) continue;

      if (!eventType.isMandatory && recipient.userId) {
        const preference = preferences.get(recipient.userId);
        const enabled = preference
          ? preference.enabled
          : eventType.defaultEnabled;
        if (!enabled || preference?.frequency === 'off') continue;
      }

      // Checked even for mandatory events: mailing a complained address is a
      // deliverability and compliance problem however important the message.
      const suppression = await this.repo.findSuppression(
        recipient.email,
        eventType.id,
      );
      if (suppression) {
        this.logger.debug(
          `Suppressed ${input.eventKey} to ${recipient.email} (${suppression.reason})`,
        );
        continue;
      }

      const locale =
        recipient.locale ??
        (recipient.userId
          ? (await this.profiles.get(recipient.userId)).locale
          : 'en');
      const template = await this.resolveTemplate(
        eventType.defaultTemplateKey ?? input.eventKey,
        locale,
      );

      const subject = template
        ? render(template.subjectTemplate, input.payload).text
        : input.eventKey;
      const bodyPreview = template
        ? render(template.bodyTextTemplate, input.payload).text.slice(
            0,
            PREVIEW_CHARS,
          )
        : null;

      pending.push({
        recipientUserId: recipient.userId ?? null,
        recipientContactId: recipient.contactId ?? null,
        // Snapshotted: a later address change must not silently redirect a
        // message already queued.
        recipientEmail: recipient.email.toLowerCase(),
        eventTypeId: eventType.id,
        templateId: template?.id ?? null,
        subject: subject.slice(0, 500),
        bodyPreview,
        payload: input.payload,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        projectId: input.projectId ?? null,
        priority: input.priority ?? 'medium',
        scheduledFor: input.scheduledFor ?? null,
        // Idempotency: a retried caller cannot enqueue the same mail twice.
        dedupeKey: input.dedupeKey
          ? `${input.eventKey}:${input.dedupeKey}:${recipient.userId ?? recipient.email}`
          : null,
        digestGroupKey:
          eventType.isDigestable && input.digestGroupKey
            ? input.digestGroupKey
            : null,
      });
    }

    if (pending.length > 0) {
      rows.push(...(await this.repo.enqueue(pending, executor)));
    }
    return rows;
  }

  /** Own notification history. */
  async listForUser(userId: string, page: number, limit: number) {
    const { rows, total } = await this.repo.listForRecipient(
      userId,
      page,
      limit,
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        preview: r.bodyPreview,
        status: r.status,
        entityType: r.entityType,
        entityId: r.entityId,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Resolve a template, validating the payload against its declared variables.
   *
   * A missing template is a warning rather than a throw: the notification still
   * queues with the event key as its subject, which is worse than a rendered
   * mail but far better than losing the notification entirely.
   */
  private async resolveTemplate(
    key: string,
    locale: string,
  ): Promise<NotificationTemplateRow | null> {
    const template = await this.repo.findTemplate(key, locale);
    if (!template) {
      this.logger.warn(
        `No active template for "${key}" (${locale}); sending an unrendered notice`,
      );
    }
    return template;
  }

  /** Validate a payload against a template before enqueueing. */
  async assertPayloadValid(
    templateKey: string,
    locale: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const template = await this.repo.findTemplate(templateKey, locale);
    if (!template) return;
    const errors = validatePayload(
      template.variables as Record<string, unknown>,
      payload,
    );
    if (errors.length > 0) {
      throw this.errors.validation(
        errors.map((message) => ({ path: 'payload', message })),
      );
    }
  }
}
