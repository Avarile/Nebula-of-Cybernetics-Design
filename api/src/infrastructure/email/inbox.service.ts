import { Injectable } from '@nestjs/common';
import { EmailConfigRepository } from './email-config.repository';
import {
  NoActiveEmailConfigError,
  type IngestMessage,
  type MailboxState,
  type MailboxSummary,
  type ParsedMessage,
} from './email.types';
import {
  fetchForIngest,
  fetchMessage,
  listMessages,
  listUidsSince,
  mailboxState,
  setSeen,
  verifyImap,
  withSession,
  type ImapSession,
} from './transport/imap.transport';

/** Inbound IMAP operations. Infra only (no HTTP). */
@Injectable()
export class InboxService {
  constructor(private readonly config: EmailConfigRepository) {}

  /**
   * Resolve the connection for a specific `imap_configs` row.
   *
   * `accountId` used to be ignored entirely — every call resolved the single
   * active config — so syncing as account A and account B pulled the SAME
   * mailbox into two partitions with independent cursors. It is now the
   * `imap_configs.id`, so the partition key names a real account.
   */
  private async connFor(accountId: string) {
    const conn = await this.config.imapById(accountId);
    if (!conn) throw new NoActiveEmailConfigError('IMAP');
    return conn;
  }

  private async conn() {
    const conn = await this.config.activeImap();
    if (!conn) throw new NoActiveEmailConfigError('IMAP');
    return conn;
  }

  /**
   * Run a batch of operations over ONE connection and mailbox lock.
   *
   * The per-operation helpers below each open their own connection, so ingesting
   * N messages cost N logins. Use this for anything that touches more than one
   * message.
   */
  async withSession<T>(
    accountId: string,
    mailbox: string,
    fn: (session: ImapSession) => Promise<T>,
  ): Promise<T> {
    return withSession(await this.connFor(accountId), mailbox, fn);
  }

  async verifyActive(): Promise<void> {
    await verifyImap(await this.conn());
  }

  async list(opts?: {
    mailbox?: string;
    limit?: number;
    unseenOnly?: boolean;
  }): Promise<MailboxSummary[]> {
    return listMessages(await this.conn(), opts);
  }

  async fetch(uid: number, mailbox?: string): Promise<ParsedMessage | null> {
    return fetchMessage(await this.conn(), uid, mailbox);
  }

  async markSeen(uid: number, mailbox?: string): Promise<void> {
    await setSeen(await this.conn(), uid, true, mailbox);
  }

  async markUnseen(uid: number, mailbox?: string): Promise<void> {
    await setSeen(await this.conn(), uid, false, mailbox);
  }

  async mailboxState(mailbox?: string): Promise<MailboxState> {
    return mailboxState(await this.conn(), mailbox);
  }

  async listUidsSince(
    sinceUid: number,
    opts?: { mailbox?: string; limit?: number },
  ): Promise<number[]> {
    return listUidsSince(await this.conn(), sinceUid, opts);
  }

  async fetchForIngest(
    uid: number,
    mailbox?: string,
  ): Promise<IngestMessage | null> {
    return fetchForIngest(await this.conn(), uid, mailbox);
  }
}
