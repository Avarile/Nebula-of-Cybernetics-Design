import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  emailAttachments,
  emailMessages,
  emailSyncState,
  type EmailAttachmentRow,
  type EmailMessageRow,
  type EmailSyncStateRow,
  type NewEmailAttachmentRow,
  type NewEmailMessageRow,
  type NewEmailSyncStateRow,
} from '../../infrastructure/database/schema/mailbox.schema';

@Injectable()
export class MailboxRepository extends BaseRepository<typeof emailMessages> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, emailMessages);
  }

  async findByUid(
    accountId: string,
    mailbox: string,
    uidValidity: number,
    uid: number,
  ): Promise<EmailMessageRow | null> {
    const rows = await this.db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.accountId, accountId),
          eq(emailMessages.mailbox, mailbox),
          eq(emailMessages.uidValidity, uidValidity),
          eq(emailMessages.uid, uid),
          eq(emailMessages.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert the message and its attachment rows atomically. */
  async insertMessageWithAttachments(
    message: NewEmailMessageRow,
    attachments: Omit<NewEmailAttachmentRow, 'emailId'>[],
  ): Promise<EmailMessageRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(emailMessages).values(message).returning();
      if (attachments.length) {
        await tx
          .insert(emailAttachments)
          .values(attachments.map((a) => ({ ...a, emailId: row.id })));
      }
      return row;
    });
  }

  async listMessages(
    accountId: string,
    mailbox: string,
    page: number,
    limit: number,
    unseenOnly: boolean,
  ): Promise<{ rows: EmailMessageRow[]; total: number }> {
    const conditions = [
      eq(emailMessages.accountId, accountId),
      eq(emailMessages.mailbox, mailbox),
      eq(emailMessages.isDeleted, false),
    ];
    if (unseenOnly) conditions.push(eq(emailMessages.seen, false));
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(emailMessages)
      .where(where)
      .orderBy(desc(emailMessages.receivedAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(emailMessages)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async findByIdWithAttachments(id: string): Promise<{
    message: EmailMessageRow;
    attachments: EmailAttachmentRow[];
  } | null> {
    const message = await this.findById(id);
    if (!message || message.isDeleted) return null;
    const attachments = await this.db
      .select()
      .from(emailAttachments)
      .where(
        and(
          eq(emailAttachments.emailId, id),
          eq(emailAttachments.isDeleted, false),
        ),
      );
    return { message, attachments };
  }

  async findAttachment(
    emailId: string,
    attachmentId: string,
  ): Promise<EmailAttachmentRow | null> {
    const rows = await this.db
      .select()
      .from(emailAttachments)
      .where(
        and(
          eq(emailAttachments.id, attachmentId),
          eq(emailAttachments.emailId, emailId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Recent, non-deleted messages eligible for a reindex sweep, newest first. */
  async listForReindex(
    accountId: string,
    mailbox: string,
    cutoff: Date,
    limit: number,
  ): Promise<EmailMessageRow[]> {
    return this.db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.accountId, accountId),
          eq(emailMessages.mailbox, mailbox),
          eq(emailMessages.isDeleted, false),
          gte(emailMessages.createdAt, cutoff),
        ),
      )
      .orderBy(desc(emailMessages.createdAt))
      .limit(limit);
  }

  async setSeen(id: string, seen: boolean): Promise<EmailMessageRow | null> {
    const rows = await this.db
      .update(emailMessages)
      .set({ seen })
      .where(eq(emailMessages.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async getSyncState(
    accountId: string,
    mailbox: string,
  ): Promise<EmailSyncStateRow | null> {
    const rows = await this.db
      .select()
      .from(emailSyncState)
      .where(
        and(
          eq(emailSyncState.accountId, accountId),
          eq(emailSyncState.mailbox, mailbox),
          eq(emailSyncState.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Insert-or-update the sync cursor in one statement.
   *
   * Read-then-write raced itself: two concurrent syncs for the same
   * `(accountId, mailbox)` both saw "no row" and both inserted, violating
   * `email_sync_state_account_mailbox_idx` and failing the sync with a 500.
   */
  async upsertSyncState(
    accountId: string,
    mailbox: string,
    patch: Partial<NewEmailSyncStateRow>,
  ): Promise<EmailSyncStateRow> {
    const [row] = await this.db
      .insert(emailSyncState)
      .values({ accountId, mailbox, ...patch })
      .onConflictDoUpdate({
        target: [emailSyncState.accountId, emailSyncState.mailbox],
        targetWhere: sql`${emailSyncState.isDeleted} = false`,
        set: patch,
      })
      .returning();
    return row;
  }
}
