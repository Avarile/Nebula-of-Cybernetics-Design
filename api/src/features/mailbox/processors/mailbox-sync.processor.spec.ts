import { MailboxSyncProcessor } from './mailbox-sync.processor';

describe('MailboxSyncProcessor', () => {
  it('delegates to ingest.sync with the job payload', async () => {
    const ingest = {
      sync: jest.fn(async () => ({ processed: 2, batchWasFull: false })),
      reconcile: jest.fn(async () => ({ reindexed: 0 })),
    };
    const queue = { add: jest.fn(async () => undefined) };
    const proc = new MailboxSyncProcessor(ingest as any, queue as any);
    await proc.process({
      name: 'sync-mailbox',
      data: { accountId: 'acc', mailbox: 'INBOX' },
    } as any);
    expect(ingest.sync).toHaveBeenCalledWith('acc', 'INBOX');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('re-enqueues a continuation when the batch was full', async () => {
    const ingest = {
      sync: jest.fn(async () => ({ processed: 200, batchWasFull: true })),
      reconcile: jest.fn(async () => ({ reindexed: 0 })),
    };
    const queue = { add: jest.fn(async () => undefined) };
    const proc = new MailboxSyncProcessor(ingest as any, queue as any);
    await proc.process({
      name: 'sync-mailbox',
      data: { accountId: 'acc', mailbox: 'INBOX' },
    } as any);
    expect(queue.add).toHaveBeenCalledWith(
      'sync-mailbox',
      { accountId: 'acc', mailbox: 'INBOX' },
      expect.any(Object),
    );
  });

  it('delegates to ingest.reconcile on a reconcile-mailbox job', async () => {
    const ingest = {
      sync: jest.fn(async () => ({ processed: 0, batchWasFull: false })),
      reconcile: jest.fn(async () => ({ reindexed: 5 })),
    };
    const queue = { add: jest.fn(async () => undefined) };
    const proc = new MailboxSyncProcessor(ingest as any, queue as any);
    await proc.process({
      name: 'reconcile-mailbox',
      data: { accountId: 'acc', mailbox: 'INBOX' },
    } as any);
    expect(ingest.reconcile).toHaveBeenCalledWith('acc', 'INBOX');
    expect(ingest.sync).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
