import { MailboxIngestService } from './mailbox-ingest.service';

function deps(over: any = {}) {
  const session = {
    state: jest.fn(async () => ({ uidValidity: 10, uidNext: 5 })),
    listUidsSince: jest.fn(async () => [3, 4]),
    setSeen: jest.fn(async () => undefined),
    fetchForIngest: jest.fn(async (uid: number) => ({
      uid,
      raw: Buffer.from(`raw${uid}`),
      messageId: `<m${uid}>`,
      inReplyTo: null,
      references: undefined,
      from: { address: 'a@x.com', name: 'A' },
      to: [],
      cc: [],
      subject: `s${uid}`,
      sentAt: new Date('2020-01-01'),
      text: 'body',
      html: null,
      seen: false,
      sizeBytes: 10,
      receivedAt: new Date('2021-06-01'),
      attachments: [],
    })),
    ...over.session,
  };
  // One connection + mailbox lock for the whole batch, rather than a login per
  // message. The double asserts that shape as much as the behaviour.
  const inbox = {
    withSession: jest.fn(
      async (_accountId: string, _mailbox: string, fn: any) => fn(session),
    ),
    ...over.session,
  };
  const repo = {
    getSyncState: jest.fn(async () => null),
    upsertSyncState: jest.fn(async () => ({})),
    findByUid: jest.fn(async () => null),
    insertMessageWithAttachments: jest.fn(async (m: any) => ({
      id: `id-${m.uid}`,
      ...m,
    })),
    listForReindex: jest.fn(async () => []),
    ...over.repo,
  };
  const files = {
    putFromStream: jest.fn(async () => ({ id: 'file-x' })),
    softDelete: jest.fn(async () => undefined),
    ...over.files,
  };
  const search = { persist: jest.fn(async () => []), ...over.search };
  const config = {
    getOrThrow: () => ({
      batchCap: 200,
      storeRaw: true,
      pushFlags: false,
      ...over.config,
    }),
  };
  const svc = new MailboxIngestService(
    inbox as any,
    repo as any,
    files as any,
    search as any,
    config as any,
  );
  return { svc, inbox, session, repo, files, search };
}

describe('MailboxIngestService.sync', () => {
  it('persists each new UID and advances the cursor', async () => {
    const { svc, repo, search } = deps();
    const res = await svc.sync('acc', 'INBOX');
    expect(res).toEqual({ processed: 2, batchWasFull: false });
    expect(repo.insertMessageWithAttachments).toHaveBeenCalledTimes(2);
    expect(search.persist).toHaveBeenCalledTimes(2);
    // final sync-state upsert marks ok with lastSeenUid = 4
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith(
      'acc',
      'INBOX',
      expect.objectContaining({ lastStatus: 'ok', lastSeenUid: 4 }),
    );
  });

  it('skips UIDs already persisted (idempotent)', async () => {
    const { svc, repo } = deps({
      repo: { findByUid: jest.fn(async () => ({ id: 'exists' })) },
    });
    await svc.sync('acc', 'INBOX');
    expect(repo.insertMessageWithAttachments).not.toHaveBeenCalled();
  });

  it('resets the cursor when server UIDVALIDITY changed', async () => {
    const { svc, session } = deps({
      repo: {
        getSyncState: jest.fn(async () => ({
          id: 's',
          uidValidity: 9,
          lastSeenUid: 100,
        })),
      },
    });
    await svc.sync('acc', 'INBOX');
    // Restarts at 0 because the stored uidValidity (9) no longer matches the
    // server's (10), which invalidates every UID recorded for this mailbox.
    expect(session.listUidsSince).toHaveBeenCalledWith(0, 200);
  });

  it('marks error and rethrows on failure', async () => {
    const { svc, repo } = deps({
      repo: {
        insertMessageWithAttachments: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    });
    await expect(svc.sync('acc', 'INBOX')).rejects.toThrow('db down');
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith(
      'acc',
      'INBOX',
      expect.objectContaining({ lastStatus: 'error' }),
    );
  });

  it('does not store the raw .eml when storeRaw is false', async () => {
    const { svc, files } = deps({ config: { storeRaw: false } });
    await svc.sync('acc', 'INBOX');
    expect(files.putFromStream).not.toHaveBeenCalled();
  });

  it('skips an attachment whose putFromStream rejects, but still persists the message', async () => {
    const putFromStream = jest
      .fn()
      .mockResolvedValueOnce({ id: 'raw-file' }) // raw .eml succeeds
      .mockRejectedValueOnce(new Error('upload failed')); // attachment fails
    const { svc, repo } = deps({
      session: {
        listUidsSince: jest.fn(async () => [3]),
        fetchForIngest: jest.fn(async (uid: number) => ({
          uid,
          raw: Buffer.from(`raw${uid}`),
          messageId: `<m${uid}>`,
          inReplyTo: null,
          references: undefined,
          from: { address: 'a@x.com', name: 'A' },
          to: [],
          cc: [],
          subject: `s${uid}`,
          sentAt: new Date('2020-01-01'),
          text: 'body',
          html: null,
          seen: false,
          sizeBytes: 10,
          attachments: [
            {
              filename: 'f.pdf',
              contentType: 'application/pdf',
              size: 5,
              contentId: null,
              inline: false,
              content: Buffer.from('x'),
            },
          ],
        })),
      },
      files: { putFromStream },
    });
    await svc.sync('acc', 'INBOX');
    expect(repo.insertMessageWithAttachments).toHaveBeenCalledTimes(1);
    const [message, attachments] =
      repo.insertMessageWithAttachments.mock.calls[0];
    expect(message.hasAttachments).toBe(false);
    expect(attachments).toEqual([]);
  });

  it('builds the payload with the fallback threadId and receivedAt from the server INTERNALDATE', async () => {
    // Deliberately different: `sentAt` is the sender-controlled `Date:` header,
    // `receivedAt` is the server's INTERNALDATE. Ordering and the reconcile
    // window both key off the latter, so a forged header must not move them.
    const sentAt = new Date('2021-06-01T00:00:00Z');
    const internalDate = new Date('2021-06-02T12:00:00Z');
    const { svc, repo } = deps({
      session: {
        listUidsSince: jest.fn(async () => [3]),
        fetchForIngest: jest.fn(async (uid: number) => ({
          uid,
          raw: Buffer.from(`raw${uid}`),
          messageId: null,
          inReplyTo: null,
          references: undefined,
          from: { address: 'a@x.com', name: 'A' },
          to: [],
          cc: [],
          subject: `s${uid}`,
          sentAt,
          receivedAt: internalDate,
          text: 'body',
          html: null,
          seen: false,
          sizeBytes: 10,
          attachments: [],
        })),
      },
    });
    await svc.sync('acc', 'INBOX');
    const [message] = repo.insertMessageWithAttachments.mock.calls[0];
    expect(message.hasAttachments).toBe(false);
    expect(message.threadId).toBe('acc:INBOX:10:3');
    expect(message.receivedAt).toBe(internalDate);
    expect(message.sentAt).toBe(sentAt);
  });

  it('is best-effort: sync still resolves and marks ok when search indexing rejects', async () => {
    const { svc, repo } = deps({
      search: {
        persist: jest.fn(async () => {
          throw new Error('meili down');
        }),
      },
    });
    const res = await svc.sync('acc', 'INBOX');
    expect(res).toEqual({ processed: 2, batchWasFull: false });
    expect(repo.insertMessageWithAttachments).toHaveBeenCalledTimes(2);
    expect(repo.upsertSyncState).toHaveBeenLastCalledWith(
      'acc',
      'INBOX',
      expect.objectContaining({ lastStatus: 'ok' }),
    );
  });
});

function makeRow(id: string): any {
  return {
    id,
    accountId: 'acc',
    mailbox: 'INBOX',
    threadId: `t-${id}`,
    subject: `subject-${id}`,
    bodyText: 'body',
    fromAddress: 'a@x.com',
    fromName: 'A',
    seen: false,
    flagged: false,
    receivedAt: new Date('2020-01-01'),
    sentAt: new Date('2020-01-01'),
  };
}

describe('MailboxIngestService.reconcile', () => {
  it('re-persists every row returned by listForReindex', async () => {
    const rows = [makeRow('m1'), makeRow('m2'), makeRow('m3')];
    const { svc, repo, search } = deps({
      repo: { listForReindex: jest.fn(async () => rows) },
    });
    const res = await svc.reconcile('acc', 'INBOX');
    expect(repo.listForReindex).toHaveBeenCalledWith(
      'acc',
      'INBOX',
      expect.any(Date),
      500,
    );
    expect(search.persist).toHaveBeenCalledTimes(3);
    expect(res).toEqual({ reindexed: 3 });
  });

  it('is best-effort: continues past a rejected persist and counts only the successes', async () => {
    const rows = [makeRow('m1'), makeRow('m2')];
    const persist = jest
      .fn()
      .mockRejectedValueOnce(new Error('meili down'))
      .mockResolvedValueOnce([]);
    const { svc, repo } = deps({
      repo: { listForReindex: jest.fn(async () => rows) },
      search: { persist },
    });
    await expect(svc.reconcile('acc', 'INBOX')).resolves.toEqual({
      reindexed: 1,
    });
    expect(repo.listForReindex).toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
