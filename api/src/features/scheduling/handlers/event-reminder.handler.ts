import { Injectable, Logger } from '@nestjs/common';
import type { ScheduledJobContext } from '../../../infrastructure/scheduling/job-handler.registry';
import { NotificationService } from '../../notifications/notification.service';
import { UserRepository } from '../../users/user.repository';

/** The catalog key this handler emits. Seeded by `NotificationCatalogSeeder`. */
export const EVENT_REMINDER_EVENT_KEY = 'calendar.event_reminder';

/**
 * Turns a due reminder into an outbox row.
 *
 * **Delivery is at-least-once by construction.** A crash between "wrote the
 * notification" and "marked the job done" is unavoidable, so this handler will
 * run twice eventually. Exactly-once is enforced at the SIDE EFFECT instead.
 * `NotificationService` composes the key passed below into
 * `calendar.event_reminder:{occurrenceId}:{offsetMs}:{userId}`, and
 * `NotificationRepository.enqueue` inserts with `onConflictDoNothing`, so the
 * second write is a no-op rather than a second email. That unique index is the
 * guarantee; nothing in the poller is.
 */
@Injectable()
export class EventReminderHandler {
  private readonly logger = new Logger(EventReminderHandler.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly users: UserRepository,
  ) {}

  async handle({ job, calendar }: ScheduledJobContext): Promise<void> {
    if (!calendar) {
      // Unreachable via `MaterializerService`, which always binds a reminder to
      // its occurrence. Thrown rather than ignored: a reminder with nothing to
      // remind anyone about is a scheduling bug, and swallowing it would retire
      // the job as `done`.
      throw new Error(
        `Reminder job ${job.id} has no calendar occurrence behind it`,
      );
    }
    const { event, occurrence } = calendar;

    const owner = await this.users.findActiveById(event.ownerUserId);
    if (!owner) {
      // Not an error: the account was deactivated between scheduling and
      // firing. Nothing to deliver, and nothing to retry.
      this.logger.debug(
        `Skipping reminder for event ${event.id}: owner is not active`,
      );
      return;
    }

    const offsetMs = Number(job.payload.offsetMs ?? 0);
    await this.notifications.enqueue({
      eventKey: EVENT_REMINDER_EVENT_KEY,
      recipients: [{ userId: owner.id, email: owner.email }],
      payload: {
        title: occurrence.titleOverride ?? event.title,
        startsAt: occurrence.startsAt.toISOString(),
        startLocal: occurrence.startLocal,
        timezone: occurrence.timezone,
        location: event.location ?? '',
        minutesBefore: Math.round(offsetMs / 60_000),
      },
      entityType: 'event',
      entityId: event.id,
      projectId: event.projectId,
      // Scoped to the occurrence AND the offset: two reminders for the same
      // meeting are two messages, a retry of one is not.
      dedupeKey: `${occurrence.id}:${offsetMs}`,
    });
  }
}
