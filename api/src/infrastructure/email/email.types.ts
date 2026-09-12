/** Resolved SMTP connection + sender identity (secret already decrypted). */
export interface SmtpConn {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
}

/** Resolved IMAP connection (secret already decrypted). */
export interface ImapConn {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
}

/** An outbound attachment. `content` is the raw bytes (or a UTF-8 string); set
 * `cid` to reference the part inline from `html` via `cid:`. */
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
}

/** An outbound message. `html` is optional; `text` is always sent. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string;
  attachments?: EmailAttachment[];
}

/** Envelope-level summary of a mailbox message. */
export interface MailboxSummary {
  uid: number;
  from: string;
  subject: string;
  date: Date;
  seen: boolean;
}

/** A fully fetched + MIME-parsed message. */
export interface ParsedMessage extends MailboxSummary {
  to: string;
  text: string;
  html: string | null;
  attachments: {
    filename: string | null;
    contentType: string;
    size: number;
  }[];
}

/** Thrown when no active SMTP/IMAP profile exists. A domain error, not HTTP. */
export class NoActiveEmailConfigError extends Error {
  constructor(kind: 'SMTP' | 'IMAP') {
    super(`No active ${kind} configuration is set`);
    this.name = 'NoActiveEmailConfigError';
  }
}

/** Mailbox status probe result used to drive incremental sync. */
export interface MailboxState {
  uidValidity: number;
  uidNext: number;
}

/** A parsed attachment including its raw bytes (for persistence). */
export interface IngestAttachment {
  filename: string | null;
  contentType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
  content: Buffer;
}

/** A fetched message with everything the persistence layer needs. */
export interface IngestMessage {
  uid: number;
  raw: Buffer;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | string[] | undefined;
  from: { address: string; name: string | null };
  to: { address: string; name: string | null }[];
  cc: { address: string; name: string | null }[];
  subject: string;
  /** The sender's `Date:` header. Sender-controlled; not an arrival time. */
  sentAt: Date | null;
  /**
   * IMAP INTERNALDATE — when the server took delivery.
   *
   * Distinct from `sentAt` on purpose. `receivedAt` used to be derived from the
   * `Date:` header, which is written by the sender: a back-dated or forged
   * header sorted the message to the bottom of an inbox ordered by
   * `receivedAt`, and could push it outside the reconcile sweep's lookback.
   */
  receivedAt: Date;
  text: string;
  html: string | null;
  seen: boolean;
  sizeBytes: number;
  attachments: IngestAttachment[];
}
