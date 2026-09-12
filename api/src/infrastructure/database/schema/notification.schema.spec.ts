import {
  notificationChannel,
  notificationDeliveryAttempts,
  notificationEventTypes,
  notificationFrequency,
  notificationPreferences,
  notificationStatus,
  notificationSuppressions,
  notificationTemplates,
  notifications,
  suppressionReason,
} from './notification.schema';

describe('notification schema', () => {
  it('sends by email only', () => {
    expect(notificationChannel.enumValues).toEqual(['email']);
  });

  it('separates a suppressed send from a failed one', () => {
    // A suppression is a correct outcome; conflating the two hides real failures.
    expect(notificationStatus.enumValues).toContain('suppressed');
    expect(notificationStatus.enumValues).toContain('failed');
  });

  it('starts every notification in the outbox', () => {
    // The row is written in the same transaction as the business change.
    expect(notifications.status.default).toBe('pending');
  });

  it('snapshots the recipient address at enqueue', () => {
    expect(notifications.recipientEmail.notNull).toBe(true);
  });

  it('supports digests and mandatory events', () => {
    expect(notificationFrequency.enumValues).toContain('daily');
    expect(notificationEventTypes.isMandatory.default).toBe(false);
  });

  it('records why an address was suppressed', () => {
    expect(suppressionReason.enumValues).toContain('hard_bounce');
    expect(suppressionReason.enumValues).toContain('complaint');
  });

  it('exposes the remaining notification tables', () => {
    expect(notificationTemplates).toBeDefined();
    expect(notificationPreferences).toBeDefined();
    expect(notificationDeliveryAttempts).toBeDefined();
    expect(notificationSuppressions).toBeDefined();
  });
});
