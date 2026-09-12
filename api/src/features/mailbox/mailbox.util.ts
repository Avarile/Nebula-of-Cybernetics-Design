import type { EmailMessageRow } from '../../infrastructure/database/schema/mailbox.schema';
import { INBOUND_EMAIL_COLLECTION } from './mailbox.constants';

/** First `<...>` token in a whitespace-separated Message-ID list, else the raw trimmed value. */
function firstToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/<[^>]+>/);
  return match ? match[0] : trimmed.split(/\s+/)[0];
}

/**
 * Thread key: root of the References chain, else the In-Reply-To target, else the
 * message's own Message-ID, else a caller-supplied fallback (never empty).
 */
export function computeThreadId(
  references: string | null,
  inReplyTo: string | null,
  messageId: string | null,
  fallback: string,
): string {
  if (references) {
    const root = firstToken(references);
    if (root) return root;
  }
  if (inReplyTo) {
    const t = firstToken(inReplyTo);
    if (t) return t;
  }
  if (messageId) {
    const t = firstToken(messageId);
    if (t) return t;
  }
  return fallback;
}

/** Single-line preview: collapse all whitespace runs to one space, trim, cap length. */
export function makeSnippet(text: string, max = 280): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** mailparser gives References as string | string[]; normalize to a space-joined string. */
export function normalizeReferences(
  refs: string | string[] | undefined,
): string | null {
  if (!refs) return null;
  const joined = Array.isArray(refs) ? refs.join(' ') : refs;
  const trimmed = joined.trim();
  return trimmed.length ? trimmed : null;
}

/** Project a message row into the Meili document for the inbound_email collection. */
export function toSearchDocument(
  row: EmailMessageRow,
): Record<string, unknown> {
  return {
    subject: row.subject,
    bodyText: row.bodyText,
    fromAddress: row.fromAddress,
    fromName: row.fromName ?? null,
    mailbox: row.mailbox,
    threadId: row.threadId,
    accountId: row.accountId,
    seen: row.seen,
    flagged: row.flagged,
    receivedAt: row.receivedAt.getTime(),
    sentAt: row.sentAt ? row.sentAt.getTime() : null,
  };
}

/** Re-exported so consumers don't reach into constants for the collection name. */
export const SEARCH_COLLECTION = INBOUND_EMAIL_COLLECTION;
