import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailboxConfig } from '../../config/configurations/mailbox.config';
import type { PresignedTarget } from '../../infrastructure/file-manage/object-storage.interface';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { InboxService } from '../../infrastructure/email/inbox.service';
import { FileService } from '../file-processor/file.service';
import { CollectionService } from '../search-service/collection.service';
import { SearchRecordService } from '../search-service/search-record.service';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import type { EmailMessageRow } from '../../infrastructure/database/schema/mailbox.schema';
import { INBOUND_EMAIL_COLLECTION } from './mailbox.constants';
import { MailboxRepository } from './mailbox.repository';
import { MailboxSyncScheduler } from './schedulers/mailbox-sync.scheduler';
import type { MessageDetail, MessageSummary } from './mailbox.types';
import { toSearchDocument } from './mailbox.util';

const INBOUND_EMAIL_FIELDS: FieldSpec[] = [
  { name: 'subject', type: 'string', searchable: true },
  { name: 'bodyText', type: 'string', searchable: true },
  { name: 'fromAddress', type: 'string', searchable: true, filterable: true },
  { name: 'fromName', type: 'string', searchable: true },
  { name: 'mailbox', type: 'string', filterable: true },
  { name: 'threadId', type: 'string', filterable: true },
  { name: 'accountId', type: 'string', filterable: true },
  { name: 'seen', type: 'boolean', filterable: true },
  { name: 'flagged', type: 'boolean', filterable: true },
  { name: 'receivedAt', type: 'number', filterable: true, sortable: true },
  { name: 'sentAt', type: 'number', sortable: true },
];

@Injectable()
export class MailboxService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailboxService.name);
  private readonly cfg: MailboxConfig;

  constructor(
    private readonly repo: MailboxRepository,
    private readonly inbox: InboxService,
    private readonly files: FileService,
    private readonly search: SearchRecordService,
    private readonly collections: CollectionService,
    private readonly scheduler: MailboxSyncScheduler,
    config: ConfigService,
    private readonly errors: ExceptionService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  /** Ensure the system-owned inbound_email collection exists (best-effort). */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.collections.ensureSystemCollection({
        name: INBOUND_EMAIL_COLLECTION,
        displayName: 'Inbound Email',
        description: 'Durably persisted inbound messages',
        fields: INBOUND_EMAIL_FIELDS,
        // A shared company mailbox with no per-user owner, mirroring the
        // `@Roles('admin')` on MailboxController. Before this the generic search
        // endpoint served these bodies — `bodyText` and all — to any
        // authenticated user, bypassing that guard entirely.
        visibility: 'private',
      });
    } catch (err) {
      this.logger.warn(
        `Could not ensure inbound_email collection: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  resolveAccountId(explicit?: string): string {
    const id = explicit ?? this.cfg.defaultAccountId;
    if (!id) {
      throw this.errors.create(ErrorCode.MAILBOX_ACCOUNT_UNRESOLVED, {
        message:
          'No mailbox account specified and MAILBOX_DEFAULT_ACCOUNT_ID is unset',
      });
    }
    return id;
  }

  async list(
    accountId: string,
    mailbox: string,
    page: number,
    limit: number,
    unseenOnly: boolean,
  ): Promise<{
    items: MessageSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { rows, total } = await this.repo.listMessages(
      accountId,
      mailbox,
      page,
      limit,
      unseenOnly,
    );
    return { items: rows.map(toSummary), total, page, limit };
  }

  async get(id: string): Promise<MessageDetail> {
    const found = await this.repo.findByIdWithAttachments(id);
    if (!found) throw this.errors.create(ErrorCode.MAILBOX_MESSAGE_NOT_FOUND);
    return {
      ...toSummary(found.message),
      to: found.message.toAddresses,
      cc: found.message.ccAddresses,
      sentAt: found.message.sentAt,
      bodyText: found.message.bodyText,
      bodyHtml: found.message.bodyHtml,
      attachments: found.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        inline: a.inline,
      })),
    };
  }

  async downloadAttachment(
    id: string,
    attachmentId: string,
  ): Promise<PresignedTarget> {
    const att = await this.repo.findAttachment(id, attachmentId);
    if (!att) throw this.errors.create(ErrorCode.MAILBOX_ATTACHMENT_NOT_FOUND);
    return this.files.getDownloadUrl(att.fileId, SYSTEM_PRINCIPAL);
  }

  async markSeen(id: string, seen: boolean): Promise<void> {
    const row = await this.repo.setSeen(id, seen);
    if (!row) throw this.errors.create(ErrorCode.MAILBOX_MESSAGE_NOT_FOUND);

    // Push the flag back to the server when configured to. Previously this only
    // ever wrote the local row, so read state diverged from the real mailbox
    // immediately and permanently — and `MAILBOX_PUSH_FLAGS`, which exists for
    // exactly this, was referenced by nothing.
    if (this.cfg.pushFlags) {
      try {
        await this.inbox.withSession(row.accountId, row.mailbox, (session) =>
          session.setSeen(row.uid, seen),
        );
      } catch (error) {
        // Local state is already updated and is the source of truth for the UI;
        // a failed push is a divergence to log, not a reason to fail the call.
        this.logger.warn(
          `Could not push \\Seen=${seen} for message ${row.id} (uid ${row.uid}) ` +
            `to the server: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    try {
      await this.search.persist(INBOUND_EMAIL_COLLECTION, [
        { externalId: row.id, document: toSearchDocument(row) },
      ]);
    } catch (error) {
      this.logger.warn(
        `Search re-index failed for message ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async triggerSync(accountId: string, mailbox: string): Promise<void> {
    await this.scheduler.enqueueSync(accountId, mailbox);
  }
}

function toSummary(row: EmailMessageRow): MessageSummary {
  return {
    id: row.id,
    mailbox: row.mailbox,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.receivedAt,
    seen: row.seen,
    flagged: row.flagged,
    hasAttachments: row.hasAttachments,
    threadId: row.threadId,
  };
}
