import { registerAs } from '@nestjs/config';

/**
 * Namespaced mailbox-ingestion config. Read directly from process.env with safe
 * defaults (these are operational tunables, not required boot secrets), so the
 * global env schema stays unchanged. Consumed by the mailbox feature.
 */
export const mailboxConfig = registerAs('mailbox', () => ({
  pollIntervalMs: intEnv('MAILBOX_POLL_INTERVAL_MS', 300_000),
  batchCap: intEnv('MAILBOX_BATCH_CAP', 200),
  storeRaw: boolEnv('MAILBOX_STORE_RAW', true),
  pushFlags: boolEnv('MAILBOX_PUSH_FLAGS', false),
  defaultAccountId: process.env.MAILBOX_DEFAULT_ACCOUNT_ID ?? null,
  mailbox: process.env.MAILBOX_DEFAULT_MAILBOX ?? 'INBOX',
}));

export type MailboxConfig = ReturnType<typeof mailboxConfig>;

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}
