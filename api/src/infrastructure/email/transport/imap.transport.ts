import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AddressObject } from 'mailparser';
import type {
  ImapConn,
  IngestAttachment,
  IngestMessage,
  MailboxState,
  MailboxSummary,
  ParsedMessage,
} from '../email.types';

function makeClient(conn: ImapConn): ImapFlow {
  return new ImapFlow({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: { user: conn.username ?? '', pass: conn.password ?? '' },
    logger: false,
  });
}

/** connect -> run fn -> always logout. */
async function withClient<T>(
  conn: ImapConn,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeClient(conn);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/**
 * One mailbox, one connection, many operations.
 *
 * Every exported helper below wraps `withClient`, which opens a TCP connection,
 * runs TLS, logs in, does one thing and logs out. `MailboxIngestService.sync`
 * called `fetchForIngest` once per message, so a single poll opened up to
 * `MAILBOX_BATCH_CAP` + 2 connections — 202 by default, every five minutes.
 * Most providers rate-limit or temporarily lock an account well before that
 * (Gmail caps simultaneous IMAP connections in the teens).
 *
 * A session holds one connection and one mailbox lock for the whole batch, so a
 * sync costs one login regardless of how many messages it moves.
 */
export interface ImapSession {
  /** UIDs strictly greater than `sinceUid`, ascending, capped at `limit`. */
  listUidsSince(sinceUid: number, limit?: number): Promise<number[]>;
  /** Fetch one message by UID, including its raw source and attachments. */
  fetchForIngest(uid: number): Promise<IngestMessage | null>;
  /** Current UIDVALIDITY / UIDNEXT for the open mailbox. */
  state(): Promise<MailboxState>;
  /** Add or remove the \Seen flag on the server. */
  setSeen(uid: number, value: boolean): Promise<void>;
}

/**
 * Open one connection + mailbox lock, hand a session to `fn`, always release.
 */
export async function withSession<T>(
  conn: ImapConn,
  mailbox: string,
  fn: (session: ImapSession) => Promise<T>,
): Promise<T> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      return await fn({
        listUidsSince: (sinceUid, limit = 200) =>
          listUidsSinceOn(client, sinceUid, limit),
        fetchForIngest: (uid) => fetchForIngestOn(client, uid),
        state: async () => {
          const status = await client.status(mailbox, {
            uidValidity: true,
            uidNext: true,
          });
          return {
            uidValidity: Number(status.uidValidity ?? 0),
            uidNext: Number(status.uidNext ?? 0),
          };
        },
        setSeen: async (uid, value) => {
          if (value) {
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          } else {
            await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
          }
        },
      });
    } finally {
      lock.release();
    }
  });
}

/** connect + login smoke test. Throws on failure. */
export async function verifyImap(conn: ImapConn): Promise<void> {
  await withClient(conn, async () => undefined);
}

export async function listMessages(
  conn: ImapConn,
  opts?: { mailbox?: string; limit?: number; unseenOnly?: boolean },
): Promise<MailboxSummary[]> {
  const mailbox = opts?.mailbox ?? 'INBOX';
  const limit = opts?.limit ?? 50;
  if (limit <= 0) return [];
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      // Resolve at most `limit` messages WITHOUT scanning the whole mailbox:
      // unseen via a server-side SEARCH, otherwise the newest `limit` by
      // sequence number. Both fetch only the messages we return — O(limit),
      // not O(mailbox) as a `1:*` / `{seen:false}` full fetch would be.
      let range: number[] | string;
      let byUid = false;
      if (opts?.unseenOnly) {
        const found = await client.search({ seen: false }, { uid: true });
        // `search` resolves to `number[] | false`; `||` normalizes the falsy
        // failure case. UIDs ascend, so the newest `limit` are the tail.
        const uids = (found || []).sort((a, b) => a - b).slice(-limit);
        if (uids.length === 0) return [];
        range = uids;
        byUid = true;
      } else {
        const exists = client.mailbox ? client.mailbox.exists : 0;
        if (exists === 0) return [];
        range = `${Math.max(1, exists - limit + 1)}:${exists}`;
      }
      const out: MailboxSummary[] = [];
      for await (const msg of client.fetch(
        range,
        { uid: true, envelope: true, flags: true },
        byUid ? { uid: true } : undefined,
      )) {
        out.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]?.address ?? '',
          subject: msg.envelope?.subject ?? '',
          date: msg.envelope?.date ?? new Date(0),
          seen: msg.flags?.has('\\Seen') ?? false,
        });
      }
      // Newest first, by UID (monotonic with arrival).
      return out.sort((a, b) => b.uid - a.uid);
    } finally {
      lock.release();
    }
  });
}

/** Flattens mailparser's `to` (a single AddressObject or an array of them) to text. */
function addressText(
  addr: AddressObject | AddressObject[] | undefined,
): string {
  if (!addr) return '';
  return Array.isArray(addr) ? addr.map((a) => a.text).join(', ') : addr.text;
}

export async function fetchMessage(
  conn: ImapConn,
  uid: number,
  mailbox = 'INBOX',
): Promise<ParsedMessage | null> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        uid,
        { uid: true, source: true, flags: true },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      return {
        uid,
        from: parsed.from?.value?.[0]?.address ?? '',
        to: addressText(parsed.to),
        subject: parsed.subject ?? '',
        date: parsed.date ?? new Date(0),
        seen: msg.flags?.has('\\Seen') ?? false,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename ?? null,
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

/** Probe a mailbox for its current UIDVALIDITY + UIDNEXT (no lock needed). */
export async function mailboxState(
  conn: ImapConn,
  mailbox = 'INBOX',
): Promise<MailboxState> {
  return withClient(conn, async (client) => {
    const status = await client.status(mailbox, {
      uidValidity: true,
      uidNext: true,
    });
    return {
      uidValidity: Number(status.uidValidity ?? 0),
      uidNext: Number(status.uidNext ?? 0),
    };
  });
}

/**
 * UIDs strictly greater than `sinceUid`, ascending, capped at `limit` (default
 * 200). The `${since+1}:*` range can echo the highest existing UID even when
 * none are newer (an IMAP quirk), so we filter `> sinceUid` defensively.
 */
async function listUidsSinceOn(
  client: ImapFlow,
  sinceUid: number,
  limit: number,
): Promise<number[]> {
  const found = await client.search(
    { uid: `${sinceUid + 1}:*` },
    { uid: true },
  );
  // `search` resolves to `number[] | false` (imapflow returns `false` if the
  // search itself failed) — `||`, not `??`, so the falsy `false` case is also
  // normalized to an empty array.
  const uids = (found || []).filter((u) => u > sinceUid).sort((a, b) => a - b);
  return uids.slice(0, limit);
}

export async function listUidsSince(
  conn: ImapConn,
  sinceUid: number,
  opts?: { mailbox?: string; limit?: number },
): Promise<number[]> {
  const mailbox = opts?.mailbox ?? 'INBOX';
  const limit = opts?.limit ?? 200;
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      return listUidsSinceOn(client, sinceUid, limit);
    } finally {
      lock.release();
    }
  });
}

/** imapflow types internalDate loosely; normalise whatever arrives. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toAddr(a: { address?: string; name?: string }): {
  address: string;
  name: string | null;
} {
  return { address: a.address ?? '', name: a.name ? a.name : null };
}

function addrList(
  addr: AddressObject | AddressObject[] | undefined,
): { address: string; name: string | null }[] {
  if (!addr) return [];
  const objs = Array.isArray(addr) ? addr : [addr];
  return objs.flatMap((o) => (o.value ?? []).map(toAddr));
}

async function fetchForIngestOn(
  client: ImapFlow,
  uid: number,
): Promise<IngestMessage | null> {
  {
    {
      const msg = await client.fetchOne(
        uid,
        {
          uid: true,
          source: true,
          flags: true,
          size: true,
          // The server's own arrival time. `Date:` is written by the sender and
          // is not when we received anything — see `receivedAt` below.
          internalDate: true,
        },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.value?.[0];
      const attachments: IngestAttachment[] = parsed.attachments.map((a) => ({
        filename: a.filename ?? null,
        contentType: a.contentType,
        size: a.size,
        contentId: a.cid ?? null,
        inline: a.contentDisposition === 'inline' || Boolean(a.related),
        content: a.content,
      }));
      return {
        uid,
        raw: msg.source,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: parsed.references,
        from: from ? toAddr(from) : { address: '', name: null },
        to: addrList(parsed.to),
        cc: addrList(parsed.cc),
        subject: parsed.subject ?? '',
        sentAt: parsed.date ?? null,
        text: parsed.text ?? '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        seen: msg.flags?.has('\\Seen') ?? false,
        sizeBytes: Number(msg.size ?? msg.source.length),
        // INTERNALDATE — when the server took delivery. Falls back to the
        // sender's `Date:` only if the server omits it.
        receivedAt: toDate(msg.internalDate) ?? parsed.date ?? new Date(),
        attachments,
      };
    }
  }
}

/** Fetch one message's raw source + parsed fields + attachment buffers by UID. */
export async function fetchForIngest(
  conn: ImapConn,
  uid: number,
  mailbox = 'INBOX',
): Promise<IngestMessage | null> {
  return withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      return fetchForIngestOn(client, uid);
    } finally {
      lock.release();
    }
  });
}

export async function setSeen(
  conn: ImapConn,
  uid: number,
  value: boolean,
  mailbox = 'INBOX',
): Promise<void> {
  await withClient(conn, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (value) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}
