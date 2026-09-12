// Mock factories must be self-contained (no references to outer `const`/`let`
// bindings): @swc/jest hoists `require('./imap.transport')` (and transitively
// `require('imapflow')` / `require('mailparser')`) above this file's own
// top-level statements, so any outer variable referenced inside the factory
// would still be in its TDZ when the factory runs. Same pattern as
// src/infrastructure/email/transport/smtp.transport.spec.ts.
jest.mock('imapflow', () => ({ ImapFlow: jest.fn() }));
jest.mock('mailparser', () => ({ simpleParser: jest.fn() }));

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  fetchForIngest,
  fetchMessage,
  listMessages,
  listUidsSince,
  mailboxState,
  setSeen,
  verifyImap,
} from './imap.transport';
import type { ImapConn } from '../email.types';

const ImapFlowMock = ImapFlow as unknown as jest.Mock;
const simpleParserMock = simpleParser as unknown as jest.Mock;

class FakeLock {
  release = jest.fn();
}

function makeClient(overrides: Record<string, any> = {}) {
  return {
    connect: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    close: jest.fn(),
    getMailboxLock: jest.fn(async () => new FakeLock()),
    fetch: jest.fn(() => iter([])),
    fetchOne: jest.fn(),
    search: jest.fn(async () => [] as number[]),
    status: jest.fn(),
    messageFlagsAdd: jest.fn(async () => true),
    messageFlagsRemove: jest.fn(async () => true),
    ...overrides,
  };
}

let currentClient: any;

const conn: ImapConn = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  username: 'user',
  password: 'pass',
};

/** Build an async iterator over the given messages for client.fetch. */
async function* iter(messages: any[]) {
  for (const m of messages) yield m;
}

describe('imap.transport', () => {
  beforeEach(() => {
    ImapFlowMock.mockClear();
    simpleParserMock.mockReset();
    currentClient = makeClient();
    ImapFlowMock.mockReturnValue(currentClient);
  });

  it('verifyImap connects then logs out', async () => {
    await verifyImap(conn);
    expect(ImapFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
    expect(currentClient.connect).toHaveBeenCalled();
    expect(currentClient.logout).toHaveBeenCalled();
  });

  it('listMessages fetches only the newest `limit` by sequence (no 1:* scan) and maps newest-first', async () => {
    const d1 = new Date('2020-01-01');
    const d2 = new Date('2020-01-02');
    currentClient.mailbox = { exists: 100 };
    currentClient.fetch.mockReturnValue(
      iter([
        {
          uid: 41,
          envelope: {
            subject: 'one',
            date: d1,
            from: [{ address: 'a@x.com' }],
          },
          flags: new Set(['\\Seen']),
        },
        {
          uid: 42,
          envelope: {
            subject: 'two',
            date: d2,
            from: [{ address: 'b@x.com' }],
          },
          flags: new Set(),
        },
      ]),
    );
    const res = await listMessages(conn, { limit: 2 });
    expect(currentClient.getMailboxLock).toHaveBeenCalledWith('INBOX');
    // Bounded, server-side sequence range for the newest 2 of 100 — never '1:*'.
    expect(currentClient.fetch).toHaveBeenCalledWith(
      '99:100',
      expect.objectContaining({ uid: true, envelope: true, flags: true }),
      undefined,
    );
    expect(res).toEqual([
      { uid: 42, from: 'b@x.com', subject: 'two', date: d2, seen: false },
      { uid: 41, from: 'a@x.com', subject: 'one', date: d1, seen: true },
    ]);
  });

  it('listMessages(unseenOnly) SEARCHes server-side then fetches only the newest matching UIDs', async () => {
    const d1 = new Date('2020-03-01');
    const d2 = new Date('2020-03-02');
    currentClient.search = jest.fn(async () => [10, 12, 11]); // unseen UIDs, unsorted
    currentClient.fetch.mockReturnValue(
      iter([
        {
          uid: 11,
          envelope: { subject: 'x', date: d1, from: [{ address: 'x@x.com' }] },
          flags: new Set(),
        },
        {
          uid: 12,
          envelope: { subject: 'y', date: d2, from: [{ address: 'y@x.com' }] },
          flags: new Set(),
        },
      ]),
    );
    const res = await listMessages(conn, { unseenOnly: true, limit: 2 });
    expect(currentClient.search).toHaveBeenCalledWith(
      { seen: false },
      { uid: true },
    );
    // Newest 2 of [10,11,12] => [11,12], fetched BY UID (not a whole-mailbox scan).
    expect(currentClient.fetch).toHaveBeenCalledWith(
      [11, 12],
      expect.objectContaining({ uid: true, envelope: true, flags: true }),
      { uid: true },
    );
    expect(res.map((r) => r.uid)).toEqual([12, 11]); // newest first
  });

  it('listMessages returns [] for an empty mailbox without fetching', async () => {
    currentClient.mailbox = { exists: 0 };
    const res = await listMessages(conn, { limit: 10 });
    expect(res).toEqual([]);
    expect(currentClient.fetch).not.toHaveBeenCalled();
  });

  it('listMessages(unseenOnly) returns [] when the search finds nothing, without fetching', async () => {
    currentClient.search = jest.fn(async () => []);
    const res = await listMessages(conn, { unseenOnly: true, limit: 10 });
    expect(res).toEqual([]);
    expect(currentClient.fetch).not.toHaveBeenCalled();
  });

  it('listMessages returns an empty array when limit is 0, without touching the server', async () => {
    currentClient.mailbox = { exists: 5 };
    const res = await listMessages(conn, { limit: 0 });
    expect(res).toEqual([]);
    expect(currentClient.fetch).not.toHaveBeenCalled();
    expect(currentClient.search).not.toHaveBeenCalled();
  });

  it('fetchMessage parses the raw source into a ParsedMessage', async () => {
    currentClient.fetchOne.mockResolvedValue({
      uid: 7,
      source: Buffer.from('raw'),
      flags: new Set(['\\Seen']),
    });
    simpleParserMock.mockResolvedValue({
      subject: 'Hello',
      from: { value: [{ address: 'a@x.com', name: 'A' }] },
      to: { text: 'me@x.com' },
      date: new Date('2020-05-05'),
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [
        { filename: 'f.pdf', contentType: 'application/pdf', size: 10 },
      ],
    });
    const res = await fetchMessage(conn, 7);
    expect(currentClient.fetchOne).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ source: true }),
      { uid: true },
    );
    expect(res).toEqual({
      uid: 7,
      from: 'a@x.com',
      to: 'me@x.com',
      subject: 'Hello',
      date: new Date('2020-05-05'),
      seen: true,
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [
        { filename: 'f.pdf', contentType: 'application/pdf', size: 10 },
      ],
    });
  });

  it('fetchMessage flattens multiple To: addresses to text', async () => {
    currentClient.fetchOne.mockResolvedValue({
      uid: 8,
      source: Buffer.from('raw'),
      flags: new Set(),
    });
    simpleParserMock.mockResolvedValue({
      subject: 'Hi all',
      from: { value: [{ address: 'a@x.com', name: 'A' }] },
      to: [{ text: 'a@x.com' }, { text: 'b@x.com' }],
      date: new Date('2020-06-01'),
      text: 'body',
      html: false,
      attachments: [],
    });
    const res = await fetchMessage(conn, 8);
    expect(res?.to).toBe('a@x.com, b@x.com');
  });

  it('fetchMessage returns null when the message is missing', async () => {
    currentClient.fetchOne.mockResolvedValue(false);
    expect(await fetchMessage(conn, 999)).toBeNull();
  });

  it('setSeen adds the \\Seen flag by UID', async () => {
    await setSeen(conn, 3, true);
    expect(currentClient.messageFlagsAdd).toHaveBeenCalledWith(3, ['\\Seen'], {
      uid: true,
    });
  });

  it('setSeen removes the \\Seen flag when value is false', async () => {
    await setSeen(conn, 3, false);
    expect(currentClient.messageFlagsRemove).toHaveBeenCalledWith(
      3,
      ['\\Seen'],
      { uid: true },
    );
  });

  it('mailboxState returns server uidValidity + uidNext', async () => {
    currentClient.status = jest.fn(async () => ({
      uidValidity: 42,
      uidNext: 99,
    }));
    const res = await mailboxState(conn, 'INBOX');
    expect(currentClient.status).toHaveBeenCalledWith('INBOX', {
      uidValidity: true,
      uidNext: true,
    });
    expect(res).toEqual({ uidValidity: 42, uidNext: 99 });
  });

  it('listUidsSince returns only UIDs strictly greater than the cursor, sorted, capped', async () => {
    currentClient.search = jest.fn(async () => [3, 5, 4, 2]); // 2 is <= cursor (IMAP N:* quirk)
    const res = await listUidsSince(conn, 2, { limit: 2 });
    expect(res).toEqual([3, 4]);
  });

  it('fetchForIngest returns raw source + parsed fields + attachment buffers', async () => {
    const raw = Buffer.from('raw-mime');
    const content = Buffer.from('PDFBYTES');
    currentClient.fetchOne.mockResolvedValue({
      uid: 7,
      source: raw,
      size: 1234,
      flags: new Set(['\\Seen']),
    });
    simpleParserMock.mockResolvedValue({
      messageId: '<m@x>',
      inReplyTo: '<p@x>',
      references: ['<r@x>', '<p@x>'],
      from: { value: [{ address: 'a@x.com', name: 'A' }] },
      to: [{ text: 'b@x.com', value: [{ address: 'b@x.com', name: 'B' }] }],
      cc: undefined,
      subject: 'Hi',
      date: new Date('2020-01-01'),
      text: 'plain',
      html: '<p>rich</p>',
      attachments: [
        {
          filename: 'f.pdf',
          contentType: 'application/pdf',
          size: 8,
          content,
          cid: 'cid-1',
          contentDisposition: 'attachment',
        },
      ],
    });
    const res = await fetchForIngest(conn, 7);
    expect(res?.raw).toBe(raw);
    expect(res?.seen).toBe(true);
    expect(res?.from).toEqual({ address: 'a@x.com', name: 'A' });
    expect(res?.to).toEqual([{ address: 'b@x.com', name: 'B' }]);
    expect(res?.attachments[0]).toEqual({
      filename: 'f.pdf',
      contentType: 'application/pdf',
      size: 8,
      contentId: 'cid-1',
      inline: false,
      content,
    });
  });

  it('fetchForIngest returns null when the message is missing', async () => {
    currentClient.fetchOne.mockResolvedValue(false);
    expect(await fetchForIngest(conn, 999)).toBeNull();
  });
});
