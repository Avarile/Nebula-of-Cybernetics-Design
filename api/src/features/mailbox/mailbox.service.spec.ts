import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { MailboxService } from './mailbox.service';

function make(over: any = {}) {
  const repo = {
    listMessages: jest.fn(async () => ({ rows: [], total: 0 })),
    findByIdWithAttachments: jest.fn(async () => null),
    findAttachment: jest.fn(async () => null),
    setSeen: jest.fn(async () => null),
    ...over.repo,
  };
  const session = { setSeen: jest.fn(async () => undefined) };
  // One connection + mailbox lock per operation batch.
  const inbox = {
    withSession: jest.fn(async (_a: string, _m: string, fn: any) =>
      fn(session),
    ),
    ...over.inbox,
  };
  const files = { getDownloadUrl: jest.fn(async () => ({ url: 'https://x' })) };
  const search = { persist: jest.fn(async () => []) };
  const collections = {
    get: jest.fn(async () => ({})),
    create: jest.fn(async () => ({})),
  };
  const scheduler = { enqueueSync: jest.fn(async () => undefined) };
  const config = {
    getOrThrow: () => ({
      defaultAccountId: 'acc-default',
      mailbox: 'INBOX',
      pushFlags: over.pushFlags ?? false,
    }),
  };
  const svc = new MailboxService(
    repo as any,
    inbox as any,
    files as any,
    search as any,
    collections as any,
    scheduler as any,
    config as any,
    new ExceptionService(),
  );
  return {
    svc,
    repo,
    inbox,
    session,
    files,
    search,
    collections,
    scheduler,
  };
}

describe('MailboxService', () => {
  it('get throws NotFound when the message is absent', async () => {
    const { svc } = make();
    await expect(svc.get('missing')).rejects.toMatchObject({
      code: ErrorCode.MAILBOX_MESSAGE_NOT_FOUND,
      message: 'Message not found',
    });
  });

  it('markSeen updates the row and re-persists the search doc', async () => {
    const row = {
      id: 'm1',
      accountId: 'acc',
      mailbox: 'INBOX',
      subject: 's',
      bodyText: 'b',
      fromAddress: 'a@x.com',
      fromName: null,
      threadId: '<t>',
      seen: true,
      flagged: false,
      receivedAt: new Date('2020-01-01'),
      sentAt: null,
    };
    const { svc, repo, search } = make({
      repo: { setSeen: jest.fn(async () => row) },
    });
    await svc.markSeen('m1', true);
    expect(repo.setSeen).toHaveBeenCalledWith('m1', true);
    expect(search.persist).toHaveBeenCalledWith('inbound_email', [
      expect.objectContaining({ externalId: 'm1' }),
    ]);
  });

  it('markSeen resolves even when search.persist rejects, and still updates the row', async () => {
    const row = {
      id: 'm1',
      accountId: 'acc',
      mailbox: 'INBOX',
      subject: 's',
      bodyText: 'b',
      fromAddress: 'a@x.com',
      fromName: null,
      threadId: '<t>',
      seen: true,
      flagged: false,
      receivedAt: new Date('2020-01-01'),
      sentAt: null,
    };
    const { svc, repo, search } = make({
      repo: { setSeen: jest.fn(async () => row) },
    });
    search.persist.mockRejectedValueOnce(new Error('meili down'));

    await expect(svc.markSeen('m1', true)).resolves.toBeUndefined();
    expect(repo.setSeen).toHaveBeenCalledWith('m1', true);
  });

  it('resolveAccountId prefers the explicit arg then the config default', () => {
    const { svc } = make();
    expect(svc.resolveAccountId('explicit')).toBe('explicit');
    expect(svc.resolveAccountId()).toBe('acc-default');
  });
});

describe('MailboxService.markSeen flag push', () => {
  const row = {
    id: 'm1',
    accountId: 'acc-1',
    mailbox: 'INBOX',
    uid: 42,
    seen: true,
  };

  // MAILBOX_PUSH_FLAGS existed for this and was referenced by nothing: markSeen
  // only ever wrote the local row, so read state diverged from the real mailbox
  // immediately and permanently.
  it('pushes the flag to the server when enabled', async () => {
    const { svc, session, inbox } = make({
      pushFlags: true,
      repo: { setSeen: jest.fn(async () => row) },
    });
    await svc.markSeen('m1', true);
    expect(inbox.withSession).toHaveBeenCalledWith(
      'acc-1',
      'INBOX',
      expect.any(Function),
    );
    expect(session.setSeen).toHaveBeenCalledWith(42, true);
  });

  it('does not touch the server when the flag is off', async () => {
    const { svc, inbox } = make({
      pushFlags: false,
      repo: { setSeen: jest.fn(async () => row) },
    });
    await svc.markSeen('m1', true);
    expect(inbox.withSession).not.toHaveBeenCalled();
  });

  // The local row is already updated and drives the UI; a server that is
  // unreachable should not fail the call.
  it('still succeeds when the push fails', async () => {
    const { svc } = make({
      pushFlags: true,
      repo: { setSeen: jest.fn(async () => row) },
      inbox: {
        withSession: jest.fn(async () => {
          throw new Error('imap down');
        }),
      },
    });
    await expect(svc.markSeen('m1', true)).resolves.toBeUndefined();
  });
});
