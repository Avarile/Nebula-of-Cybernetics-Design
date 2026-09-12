import { Test, type TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { ConfigModule } from '../src/config/config.module';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../src/infrastructure/database/drizzle.constants';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { files } from '../src/infrastructure/database/schema/file.schema';
import {
  emailAttachments,
  emailMessages,
  emailSyncState,
} from '../src/infrastructure/database/schema/mailbox.schema';
import { imapConfigs } from '../src/infrastructure/database/schema/system.schema';
import { FileManageModule } from '../src/infrastructure/file-manage/file-manage.module';
import { InboxService } from '../src/infrastructure/email/inbox.service';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';
import { MailboxIngestService } from '../src/features/mailbox/mailbox-ingest.service';
import { MailboxModule } from '../src/features/mailbox/mailbox.module';
import { MailboxRepository } from '../src/features/mailbox/mailbox.repository';

jest.setTimeout(30_000);

/**
 * A fake IMAP source: one message with one small attachment.
 *
 * Shaped as a session, not as loose per-operation calls: `MailboxIngestService`
 * now runs the whole batch inside a single `withSession(accountId, mailbox, fn)`
 * so a sync costs one login rather than one per message. This double kept the
 * older flat API and stopped matching the service it stands in for.
 */
const fakeSession = {
  state: async () => ({ uidValidity: 1, uidNext: 2 }),
  listUidsSince: async (since: number) => (since < 1 ? [1] : []),
  setSeen: async () => undefined,
  fetchForIngest: async (uid: number) => ({
    uid,
    raw: Buffer.from('From: a@x.com\r\nSubject: Hello\r\n\r\nbody'),
    messageId: '<m1@x>',
    inReplyTo: null,
    references: undefined,
    from: { address: 'a@x.com', name: 'A' },
    to: [{ address: 'me@x.com', name: null }],
    cc: [],
    subject: 'Hello',
    sentAt: new Date('2020-01-01'),
    // The server's INTERNALDATE, deliberately distinct from the sender-supplied
    // `sentAt`. It is NOT NULL in `email_messages` and has no DB default, so a
    // double that omits it fails the insert rather than the assertion.
    receivedAt: new Date('2020-01-02'),
    text: 'body',
    html: null,
    seen: false,
    sizeBytes: 40,
    attachments: [
      {
        filename: 'note.txt',
        contentType: 'text/plain',
        size: 3,
        contentId: null,
        inline: false,
        content: Buffer.from('abc'),
      },
    ],
  }),
};

const fakeInbox = {
  withSession: async <T>(
    _accountId: string,
    _mailbox: string,
    fn: (session: typeof fakeSession) => Promise<T>,
  ): Promise<T> => fn(fakeSession),
};

/**
 * Mailbox-ingestion persistence e2e. Boots a focused module subset (never
 * AppModule, to avoid the Mastra ESM/Jest break) — ConfigModule + DatabaseModule
 * + ExceptionsModule + LoggerModule + FileManageModule + SearchEngineModule +
 * QueueModule + MailboxModule (ExceptionsModule is required so
 * FileService/MailboxService, which throw via ExceptionService, can resolve
 * their dependency; LoggerModule because GlobalExceptionFilter injects
 * nestjs-pino's PinoLogger) — and overrides `InboxService` with a fake IMAP
 * source (one message, one small
 * attachment), so the test proves the real persistence path (Postgres + MinIO +
 * MeiliSearch) without a live mailbox. Mirrors password-reset.e2e-spec.ts
 * (module-subset boot + `.overrideProvider(...).useValue(...)`) and
 * search.e2e-spec.ts (real MeiliSearch/MinIO wiring).
 *
 * Requires Postgres (migrated) + Redis + MinIO + MeiliSearch, all reachable via
 * `.env`. Run with `pnpm test:e2e -- mailbox-ingest.e2e`.
 */
describe('Mailbox ingestion (e2e)', () => {
  let moduleRef: TestingModule;
  let ingest: MailboxIngestService;
  let repo: MailboxRepository;
  let db: DrizzleDB;
  const accountId = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        FileManageModule,
        SearchEngineModule,
        QueueModule,
        MailboxModule,
      ],
    })
      .overrideProvider(InboxService)
      .useValue(fakeInbox)
      .compile();
    await moduleRef.init();
    ingest = moduleRef.get(MailboxIngestService);
    repo = moduleRef.get(MailboxRepository);
    db = moduleRef.get(DRIZZLE);

    // Migration 0012 added `email_sync_state.account_id -> imap_configs.id`
    // (plus four sibling FKs on the mailbox tables). This suite used to sync
    // against a bare synthetic uuid, which the FK now rejects — so give the
    // fixture a real config row to point at. `isActive` stays false: there is a
    // partial unique index allowing only one active config, and this must not
    // collide with whatever the environment already has.
    await db
      .insert(imapConfigs)
      .values({
        id: accountId,
        name: 'mailbox-ingest-e2e',
        host: 'imap.invalid',
        port: 993,
        isActive: false,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Guard the DB cleanup: if `beforeAll` threw before `db` was assigned,
    // don't let cleanup itself throw a confusing "undefined" error on top.
    if (db) {
      // Clean up the rows this test created for the dedicated test accountId —
      // do not leave orphaned test data in the live DB. (Leaving the
      // `inbound_email` Meili collection behind is fine; it's a system collection.)
      //
      // Every `ingest.sync` run also calls `FileService.putFromStream` twice
      // (the raw `.eml`, since `storeRaw` defaults true, plus the `note.txt`
      // attachment). Content-addressed dedup means the MinIO object may be
      // shared/reused, but each run still inserts a NEW `files` DB row — so we
      // must collect and delete those rows too, or they leak unbounded. We
      // intentionally do NOT delete the MinIO objects themselves: they may be
      // shared with other rows, and only the `files` DB row is the leak.
      const messages = await db
        .select({ id: emailMessages.id, rawFileId: emailMessages.rawFileId })
        .from(emailMessages)
        .where(eq(emailMessages.accountId, accountId));

      const fileIds = new Set<string>();
      for (const { rawFileId } of messages) {
        if (rawFileId) fileIds.add(rawFileId);
      }
      for (const { id } of messages) {
        const attachments = await db
          .select({ fileId: emailAttachments.fileId })
          .from(emailAttachments)
          .where(eq(emailAttachments.emailId, id));
        for (const { fileId } of attachments) {
          fileIds.add(fileId);
        }
        await db
          .delete(emailAttachments)
          .where(eq(emailAttachments.emailId, id));
      }
      await db
        .delete(emailMessages)
        .where(eq(emailMessages.accountId, accountId));
      await db
        .delete(emailSyncState)
        .where(eq(emailSyncState.accountId, accountId));

      if (fileIds.size > 0) {
        await db.delete(files).where(inArray(files.id, [...fileIds]));
      }

      // Last: everything above references it via the migration-0012 FKs.
      await db.delete(imapConfigs).where(eq(imapConfigs.id, accountId));
    }

    await moduleRef?.close();
  });

  it('persists a fetched message + attachment and is idempotent on re-run', async () => {
    const first = await ingest.sync(accountId, 'INBOX');
    expect(first.processed).toBe(1);

    const state = await repo.getSyncState(accountId, 'INBOX');
    expect(state?.lastSeenUid).toBe(1);
    expect(state?.lastStatus).toBe('ok');

    const stored = await repo.findByUid(accountId, 'INBOX', 1, 1);
    expect(stored?.subject).toBe('Hello');
    expect(stored?.hasAttachments).toBe(true);

    const withAtt = await repo.findByIdWithAttachments(stored!.id);
    expect(withAtt?.attachments).toHaveLength(1);
    expect(withAtt?.attachments[0].filename).toBe('note.txt');

    // Re-run: nothing new (idempotent on the UID key).
    const second = await ingest.sync(accountId, 'INBOX');
    expect(second.processed).toBe(0);
  });
});
