import { mailboxConfig } from './mailbox.config';

describe('mailboxConfig', () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  it('applies sane defaults when env is unset', () => {
    process.env = { ...OLD };
    delete process.env.MAILBOX_POLL_INTERVAL_MS;
    delete process.env.MAILBOX_BATCH_CAP;
    delete process.env.MAILBOX_STORE_RAW;
    delete process.env.MAILBOX_PUSH_FLAGS;
    const cfg = mailboxConfig();
    expect(cfg.pollIntervalMs).toBe(300_000);
    expect(cfg.batchCap).toBe(200);
    expect(cfg.storeRaw).toBe(true);
    expect(cfg.pushFlags).toBe(false);
    expect(cfg.mailbox).toBe('INBOX');
  });

  it('reads overrides from env', () => {
    process.env = {
      ...OLD,
      MAILBOX_BATCH_CAP: '50',
      MAILBOX_STORE_RAW: 'false',
    };
    const cfg = mailboxConfig();
    expect(cfg.batchCap).toBe(50);
    expect(cfg.storeRaw).toBe(false);
  });
});
