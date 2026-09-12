import type { EmailMessageRow } from '../../infrastructure/database/schema/mailbox.schema';
import {
  computeThreadId,
  makeSnippet,
  normalizeReferences,
  toSearchDocument,
} from './mailbox.util';

describe('mailbox.util', () => {
  it('computeThreadId prefers the References root', () => {
    expect(
      computeThreadId('<root@x> <mid@x>', '<mid@x>', '<self@x>', 'fb'),
    ).toBe('<root@x>');
  });
  it('computeThreadId falls back to In-Reply-To, then Message-ID, then fallback', () => {
    expect(computeThreadId(null, '<parent@x>', '<self@x>', 'fb')).toBe(
      '<parent@x>',
    );
    expect(computeThreadId(null, null, '<self@x>', 'fb')).toBe('<self@x>');
    expect(computeThreadId(null, null, null, 'fb')).toBe('fb');
  });
  it('makeSnippet collapses whitespace and caps length', () => {
    expect(makeSnippet('  a\n\n b   c ')).toBe('a b c');
    expect(makeSnippet('x'.repeat(400)).length).toBe(280);
  });
  it('normalizeReferences joins arrays and trims', () => {
    expect(normalizeReferences(['<a@x>', '<b@x>'])).toBe('<a@x> <b@x>');
    expect(normalizeReferences('<a@x>')).toBe('<a@x>');
    expect(normalizeReferences(undefined)).toBeNull();
  });
  it('toSearchDocument projects the searchable fields with epoch timestamps', () => {
    const row = {
      id: 'id-1',
      accountId: 'acc-1',
      mailbox: 'INBOX',
      subject: 'Hi',
      bodyText: 'body',
      fromAddress: 'a@x.com',
      fromName: 'A',
      threadId: '<root@x>',
      seen: false,
      flagged: false,
      receivedAt: new Date('2020-01-02T00:00:00Z'),
      sentAt: new Date('2020-01-01T00:00:00Z'),
    } as unknown as EmailMessageRow;
    expect(toSearchDocument(row)).toEqual({
      subject: 'Hi',
      bodyText: 'body',
      fromAddress: 'a@x.com',
      fromName: 'A',
      mailbox: 'INBOX',
      threadId: '<root@x>',
      accountId: 'acc-1',
      seen: false,
      flagged: false,
      receivedAt: new Date('2020-01-02T00:00:00Z').getTime(),
      sentAt: new Date('2020-01-01T00:00:00Z').getTime(),
    });
  });
});
