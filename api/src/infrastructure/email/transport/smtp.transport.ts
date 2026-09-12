import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, SmtpConn } from '../email.types';

/**
 * Pooled transports, keyed by connection identity.
 *
 * Every send used to build a transport, connect, send and tear down. Nodemailer
 * pools connections when asked to, and the active SMTP profile changes rarely,
 * so one transport per distinct config removes a TCP+TLS+AUTH round trip from
 * every outbound mail — including the password-reset path, which sends on each
 * forgot-password request.
 */
const pool = new Map<string, Transporter>();

/** Identity of a connection, so a config change gets its own transport. */
function poolKey(conn: SmtpConn): string {
  return [conn.host, conn.port, conn.secure, conn.username ?? ''].join('|');
}

function buildTransport(conn: SmtpConn): Transporter {
  const key = poolKey(conn);
  const existing = pool.get(key);
  if (existing) return existing;

  const transport = createTransport({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: conn.username
      ? { user: conn.username, pass: conn.password ?? '' }
      : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  pool.set(key, transport);
  return transport;
}

/** Close every pooled transport. For shutdown and for tests. */
export function closeSmtpPool(): void {
  for (const transport of pool.values()) transport.close();
  pool.clear();
}

/** Connect + EHLO/AUTH check. Throws on any failure. No mail is sent. */
export async function verifySmtp(conn: SmtpConn): Promise<void> {
  // Not pooled: an admin "test this config" should exercise a real connection
  // and must not leave a transport behind for a config that may be wrong.
  const transport = createTransport({
    host: conn.host,
    port: conn.port,
    secure: conn.secure,
    auth: conn.username
      ? { user: conn.username, pass: conn.password ?? '' }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/** Send one message through the given connection. Throws on send failure. */
export async function sendMail(
  conn: SmtpConn,
  msg: EmailMessage,
): Promise<void> {
  // Pooled — see `buildTransport`. Deliberately not closed here.
  const transport = buildTransport(conn);
  {
    await transport.sendMail({
      from: conn.fromName
        ? `${conn.fromName} <${conn.fromAddress}>`
        : conn.fromAddress,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments,
    });
  }
}
