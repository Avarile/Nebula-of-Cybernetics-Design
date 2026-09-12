import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailboxConfig } from '../../config/configurations/mailbox.config';
import { InboxService } from '../../infrastructure/email/inbox.service';
import { FileService } from '../file-processor/file.service';
import { SYSTEM_PRINCIPAL } from '../../common/principal';
import { SearchRecordService } from '../search-service/search-record.service';
import {
  INBOUND_EMAIL_COLLECTION,
  RECONCILE_BATCH,
  RECONCILE_LOOKBACK_MS,
} from './mailbox.constants';
import { MailboxRepository } from './mailbox.repository';
import type { NewEmailAttachmentRow } from '../../infrastructure/database/schema/mailbox.schema';
import type { IngestMessage } from '../../infrastructure/email/email.types';
import {
  computeThreadId,
  makeSnippet,
  normalizeReferences,
  toSearchDocument,
} from './mailbox.util';

@Injectable()
export class MailboxIngestService {
  private readonly logger = new Logger(MailboxIngestService.name);
  private readonly cfg: MailboxConfig;

  constructor(
    private readonly inbox: InboxService,
    private readonly repo: MailboxRepository,
    private readonly files: FileService,
    private readonly search: SearchRecordService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<MailboxConfig>('mailbox');
  }

  /**
   * Pull one batch of new messages for `(accountId, mailbox)`.
   *
   * The whole batch runs inside ONE IMAP session. This used to open a fresh
   * connection — TCP, TLS, LOGIN, LOGOUT — for the mailbox probe, for the UID
   * listing, and then once per message, so a single poll could open
   * `MAILBOX_BATCH_CAP` + 2 connections (202 by default) every five minutes.
   * Most providers rate-limit or lock an account long before that.
   */
  async sync(
    accountId: string,
    mailbox: string,
  ): Promise<{ processed: number; batchWasFull: boolean }> {
    await this.repo.upsertSyncState(accountId, mailbox, {
      lastStatus: 'running',
      lastSyncStartedAt: new Date(),
      lastError: null,
    });

    let lastSeenUid = 0;
    try {
      const state = await this.repo.getSyncState(accountId, mailbox);

      const { processed, batchWasFull, cursor, uidValidity } =
        await this.inbox.withSession(accountId, mailbox, async (session) => {
          const server = await session.state();
          // A changed UIDVALIDITY invalidates every stored UID for this mailbox,
          // so the cursor restarts rather than skipping the whole history.
          const uidValidityChanged =
            state?.uidValidity != null &&
            state.uidValidity !== server.uidValidity;
          let cursor = uidValidityChanged ? 0 : (state?.lastSeenUid ?? 0);

          const uids = await session.listUidsSince(cursor, this.cfg.batchCap);
          let processed = 0;
          for (const uid of uids) {
            const already = await this.repo.findByUid(
              accountId,
              mailbox,
              server.uidValidity,
              uid,
            );
            if (!already) {
              const msg = await session.fetchForIngest(uid);
              if (msg) {
                await this.persist(accountId, mailbox, server.uidValidity, msg);
                processed++;
              }
            }
            cursor = uid;
          }
          return {
            processed,
            batchWasFull: uids.length >= this.cfg.batchCap,
            cursor,
            uidValidity: server.uidValidity,
          };
        });

      lastSeenUid = cursor;
      await this.repo.upsertSyncState(accountId, mailbox, {
        uidValidity,
        lastSeenUid,
        lastStatus: 'ok',
        lastSyncFinishedAt: new Date(),
        lastError: null,
      });
      return { processed, batchWasFull };
    } catch (error) {
      await this.repo.upsertSyncState(accountId, mailbox, {
        lastSeenUid,
        lastStatus: 'error',
        lastSyncFinishedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reconciliation sweep: re-persist recent, non-deleted messages so any whose
   * search document failed to index during ingest (best-effort there) get a
   * chance to converge. `SearchRecordService.persist` is idempotent — it
   * no-ops when the record is already INDEXED with a matching checksum.
   */
  async reconcile(
    accountId: string,
    mailbox: string,
  ): Promise<{ reindexed: number }> {
    const cutoff = new Date(Date.now() - RECONCILE_LOOKBACK_MS);
    const rows = await this.repo.listForReindex(
      accountId,
      mailbox,
      cutoff,
      RECONCILE_BATCH,
    );
    let reindexed = 0;
    for (const row of rows) {
      try {
        await this.search.persist(INBOUND_EMAIL_COLLECTION, [
          { externalId: row.id, document: toSearchDocument(row) },
        ]);
        reindexed++;
      } catch (error) {
        this.logger.warn(
          `Reindex failed for message ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { reindexed };
  }

  private async persist(
    accountId: string,
    mailbox: string,
    uidValidity: number,
    msg: IngestMessage,
  ): Promise<void> {
    let rawFileId: string | null = null;
    if (this.cfg.storeRaw) {
      const raw = await this.files.putFromStream(
        msg.raw,
        {
          // Namespaced: `${uid}.eml` alone collides across mailboxes and accounts.
          filename: `${accountId}-${mailbox}-${msg.uid}.eml`,
          mimeType: 'message/rfc822',
          size: msg.raw.length,
          allowAnyMime: true,
          metadata: { kind: 'inbound-email-raw' },
        },
        SYSTEM_PRINCIPAL,
      );
      rawFileId = raw.id;
    }

    const attachmentRows: Omit<NewEmailAttachmentRow, 'emailId'>[] = [];
    for (const att of msg.attachments) {
      try {
        const file = await this.files.putFromStream(
          att.content,
          {
            filename: att.filename ?? 'attachment',
            mimeType: att.contentType,
            size: att.size,
            allowAnyMime: true,
            metadata: { kind: 'inbound-email-attachment' },
          },
          SYSTEM_PRINCIPAL,
        );
        attachmentRows.push({
          fileId: file.id,
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          contentId: att.contentId,
          inline: att.inline,
        });
      } catch (error) {
        this.logger.warn(
          `Skipped attachment "${att.filename ?? 'attachment'}" (uid ${msg.uid}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const references = normalizeReferences(msg.references);
    // Track what we uploaded so a failed insert does not leak it. The bytes go
    // to MinIO before the row exists (the attachment rows need the message id),
    // so without this a failed transaction left `files` rows that nothing
    // referenced and that the file sweep never collects — they are AVAILABLE,
    // not soft-deleted.
    const uploadedFileIds = [
      ...(rawFileId ? [rawFileId] : []),
      ...attachmentRows.map((a) => a.fileId),
    ];
    let row: Awaited<
      ReturnType<MailboxRepository['insertMessageWithAttachments']>
    >;
    try {
      row = await this.repo.insertMessageWithAttachments(
        {
          accountId,
          mailbox,
          uid: msg.uid,
          uidValidity,
          messageId: msg.messageId,
          inReplyTo: msg.inReplyTo,
          references,
          threadId: computeThreadId(
            references,
            msg.inReplyTo,
            msg.messageId,
            `${accountId}:${mailbox}:${uidValidity}:${msg.uid}`,
          ),
          fromAddress: msg.from.address,
          fromName: msg.from.name,
          toAddresses: msg.to.map((a) => ({
            address: a.address,
            name: a.name,
          })),
          ccAddresses: msg.cc.map((a) => ({
            address: a.address,
            name: a.name,
          })),
          subject: msg.subject,
          sentAt: msg.sentAt,
          // The server's INTERNALDATE, not the sender's `Date:` header. This
          // column is the inbox ordering AND the reconcile sweep's window, so a
          // forged or merely wrong `Date:` used to bury a message and could put
          // it outside the lookback entirely.
          receivedAt: msg.receivedAt,
          snippet: makeSnippet(msg.text),
          bodyText: msg.text,
          bodyHtml: msg.html,
          sizeBytes: msg.sizeBytes,
          seen: msg.seen,
          hasAttachments: attachmentRows.length > 0,
          rawFileId,
        },
        attachmentRows,
      );
    } catch (error) {
      await Promise.all(
        uploadedFileIds.map((id) =>
          this.files.softDelete(id, SYSTEM_PRINCIPAL).catch(() => undefined),
        ),
      );
      throw error;
    }

    try {
      await this.search.persist(INBOUND_EMAIL_COLLECTION, [
        { externalId: row.id, document: toSearchDocument(row) },
      ]);
    } catch (error) {
      // Loud, and deliberately so. `persist` throwing means NO search record was
      // written — a validation failure writes nothing at all — and the mailbox
      // reconcile sweep only revisits messages inside its 7-day lookback. Past
      // that window this message is invisible to search with nothing left to
      // re-drive it, so this line is the only trace.
      this.logger.error(
        `Message ${row.id} persisted but NOT indexed; it will be retried only ` +
          `while it stays inside the ${RECONCILE_LOOKBACK_MS / 86_400_000}-day ` +
          `reconcile window: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
