import { MailboxReconciliationScheduler } from './mailbox-reconciliation.scheduler';

function make(accountIds: string[] = ['acc-1']) {
  const queue = {
    upsertJobScheduler: jest.fn(async () => undefined),
    add: jest.fn(async () => undefined),
  };
  const accounts = { listLiveIds: jest.fn(async () => accountIds) };
  const config = {
    getOrThrow: jest.fn(() => ({
      pollIntervalMs: 300_000,
      batchCap: 200,
      storeRaw: true,
      pushFlags: false,
      defaultAccountId: null,
      mailbox: 'INBOX',
    })),
  };
  return {
    scheduler: new MailboxReconciliationScheduler(
      queue as never,
      accounts as never,
      config as never,
    ),
    queue,
    accounts,
    config,
  };
}

describe('MailboxReconciliationScheduler', () => {
  describe('onApplicationBootstrap', () => {
    it('does not register anything when there are no IMAP accounts', async () => {
      const { scheduler, queue } = make([]);
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('registers an idempotent sweep per account', async () => {
      const { scheduler, queue } = make(['acc-1']);
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        'mailbox-reconcile:acc-1:INBOX',
        expect.objectContaining({ every: expect.any(Number) }),
        expect.objectContaining({
          name: 'reconcile-mailbox',
          data: { accountId: 'acc-1', mailbox: 'INBOX' },
        }),
      );
    });

    // The sweep used to be pinned to MAILBOX_DEFAULT_ACCOUNT_ID, so a second
    // account could be synced through the API and then never reconciled.
    it('covers every live account, not just a configured default', async () => {
      const { scheduler, queue } = make(['acc-1', 'acc-2', 'acc-3']);
      await scheduler.onApplicationBootstrap();
      expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(3);
      const ids = queue.upsertJobScheduler.mock.calls.map(
        (call) => (call as unknown as [string])[0],
      );
      expect(ids).toEqual([
        'mailbox-reconcile:acc-1:INBOX',
        'mailbox-reconcile:acc-2:INBOX',
        'mailbox-reconcile:acc-3:INBOX',
      ]);
    });

    it('does not block boot when Redis is unavailable', async () => {
      const { scheduler, queue } = make(['acc-1']);
      queue.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'));
      await expect(scheduler.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('does nothing in an API-only process', async () => {
      const previous = process.env.WORKER_ENABLED;
      process.env.WORKER_ENABLED = 'false';
      try {
        const { scheduler, queue, accounts } = make(['acc-1']);
        await scheduler.onApplicationBootstrap();
        expect(accounts.listLiveIds).not.toHaveBeenCalled();
        expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.WORKER_ENABLED;
        else process.env.WORKER_ENABLED = previous;
      }
    });
  });
});
