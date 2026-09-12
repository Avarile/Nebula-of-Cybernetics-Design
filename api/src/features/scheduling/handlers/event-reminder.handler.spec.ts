import type { ScheduledJobContext } from '../../../infrastructure/scheduling/job-handler.registry';
import { EventReminderHandler } from './event-reminder.handler';

function context(over: Partial<ScheduledJobContext> = {}): ScheduledJobContext {
  return {
    job: { id: 'job-1', payload: { offsetMs: 900_000 } },
    calendar: {
      event: {
        id: 'event-1',
        ownerUserId: 'user-1',
        title: 'Standup',
        location: 'Room 2',
        projectId: null,
      },
      occurrence: {
        id: 'occ-1',
        startsAt: new Date('2025-10-01T09:00:00Z'),
        startLocal: '2025-10-01 20:00:00',
        timezone: 'Australia/Melbourne',
        titleOverride: null,
      },
    },
    ...over,
  } as ScheduledJobContext;
}

describe('EventReminderHandler', () => {
  let notifications: { enqueue: jest.Mock };
  let users: { findActiveById: jest.Mock };
  let handler: EventReminderHandler;

  beforeEach(() => {
    notifications = { enqueue: jest.fn().mockResolvedValue([]) };
    users = {
      findActiveById: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'owner@example.com' }),
    };
    handler = new EventReminderHandler(notifications as never, users as never);
  });

  it('writes an outbox row keyed so a re-run cannot send twice', async () => {
    // Delivery is at-least-once by construction — a crash between "sent" and
    // "marked done" is unavoidable. Exactly-once lives on the unique index
    // behind `notifications.dedupe_key`, not in the poller.
    await handler.handle(context());
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'calendar.event_reminder',
        dedupeKey: 'occ-1:900000',
        recipients: [{ userId: 'user-1', email: 'owner@example.com' }],
      }),
    );
  });

  it('gives two lead times two distinct keys', async () => {
    await handler.handle(
      context({ job: { id: 'job-1', payload: { offsetMs: 0 } } as never }),
    );
    expect(notifications.enqueue.mock.calls[0][0].dedupeKey).toBe('occ-1:0');
  });

  it('renders the local reading, not the instant', async () => {
    await handler.handle(context());
    expect(notifications.enqueue.mock.calls[0][0].payload).toMatchObject({
      startLocal: '2025-10-01 20:00:00',
      timezone: 'Australia/Melbourne',
      minutesBefore: 15,
    });
  });

  it('prefers a single-instance title override', async () => {
    await handler.handle(
      context({
        calendar: {
          event: { id: 'event-1', ownerUserId: 'user-1', title: 'Standup' },
          occurrence: {
            id: 'occ-1',
            startsAt: new Date(),
            startLocal: '2025-10-01 20:00:00',
            timezone: 'UTC',
            titleOverride: 'Moved standup',
          },
        } as never,
      }),
    );
    expect(notifications.enqueue.mock.calls[0][0].payload.title).toBe(
      'Moved standup',
    );
  });

  it('refuses a job with no occurrence behind it', async () => {
    // Unreachable via the materializer, which always binds a reminder to its
    // occurrence. Throwing beats ignoring: swallowing it would retire the job
    // as `done` and the reminder would vanish without a trace.
    await expect(handler.handle(context({ calendar: null }))).rejects.toThrow(
      /no calendar occurrence/,
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing, and does not fail, when the owner is deactivated', async () => {
    // Not an error: there is nothing to deliver and nothing to retry, so
    // failing would burn attempts and eventually dead-letter for no reason.
    users.findActiveById.mockResolvedValue(null);
    await expect(handler.handle(context())).resolves.toBeUndefined();
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });
});
