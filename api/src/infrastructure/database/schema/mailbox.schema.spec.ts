import {
  emailAttachments,
  emailMessages,
  emailSyncState,
} from './mailbox.schema';

describe('mailbox.schema', () => {
  it('defines the three inbound-email tables', () => {
    expect(emailMessages).toBeDefined();
    expect(emailAttachments).toBeDefined();
    expect(emailSyncState).toBeDefined();
  });

  it('email_messages carries the IMAP identity + local-state columns', () => {
    const cols = emailMessages as unknown as Record<string, unknown>;
    for (const c of [
      'accountId',
      'mailbox',
      'uid',
      'uidValidity',
      'messageId',
      'threadId',
      'fromAddress',
      'subject',
      'receivedAt',
      'snippet',
      'bodyText',
      'seen',
      'hasAttachments',
      'rawFileId',
    ]) {
      expect(cols[c]).toBeDefined();
    }
  });
});
