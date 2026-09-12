import type { EmailAddress } from '../../infrastructure/database/schema/mailbox.schema';

/** One row in the inbox list view. */
export interface MessageSummary {
  id: string;
  mailbox: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  receivedAt: Date;
  seen: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  threadId: string | null;
}

/** An attachment as returned to the API (bytes fetched via a separate download call). */
export interface AttachmentView {
  id: string;
  filename: string | null;
  contentType: string;
  size: number;
  inline: boolean;
}

/** The full message read view. */
export interface MessageDetail extends MessageSummary {
  to: EmailAddress[];
  cc: EmailAddress[];
  sentAt: Date | null;
  bodyText: string;
  bodyHtml: string | null;
  attachments: AttachmentView[];
}
