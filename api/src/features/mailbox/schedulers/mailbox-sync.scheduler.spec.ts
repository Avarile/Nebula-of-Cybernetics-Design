import { MailboxSyncScheduler } from './mailbox-sync.scheduler';

function make(cfg: {
  pollIntervalMs?: number;
  defaultAccountId?: string | null;
  mailbox?: string;
}) {
  const queue = {
    upsertJobScheduler: jest.fn(async () => undefined),
    add: jest.fn(async () => undefined),
  };
  const config = {
    getOrThrow: jest.fn(() => ({
      pollIntervalMs: 300_000,
      batchCap: 200,
      storeRaw: true,
      pushFlags: false,
      defaultAccountId: null,
      mailbox: 'INBOX',
      ...cfg,
    })),
  };
  return {
    scheduler: new MailboxSyncScheduler(queue as never, config as never),
    queue,
    config,
  };
}

describe('MailboxSyncScheduler', () => {
  describe('onApplicationBootstrap', () => {
    it('does not register a poll when defaultAccountId is unset', async () => {
      const { scheduler, queue } = make({ defaultAccountId: null });
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('does not register a poll when defaultAccountId is empty', async () => {
      const { scheduler, queue } = make({ defaultAccountId: '' });
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('registers an idempotent job scheduler when defaultAccountId is set', async () => {
      const { scheduler, queue } = make({
        defaultAccountId: 'acc-1',
        mailbox: 'INBOX',
        pollIntervalMs: 60_000,
      });
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'mailbox-poll:acc-1:INBOX',
        { every: 60_000 },
        expect.objectContaining({
          name: 'sync-mailbox',
          data: { accountId: 'acc-1', mailbox: 'INBOX' },
        }),
      );
    });
  });

  describe('enqueueSync', () => {
    it('adds a one-off sync job with the shared job opts', async () => {
      const { scheduler, queue } = make({ defaultAccountId: 'acc-1' });
      await scheduler.enqueueSync('acc-2', 'Sent');
      expect(queue.add).toHaveBeenCalledWith(
        'sync-mailbox',
        { accountId: 'acc-2', mailbox: 'Sent' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });
});
