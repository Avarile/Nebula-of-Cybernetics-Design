// The mock factory below must be self-contained (no references to outer
// `const`/`let` bindings): @swc/jest hoists `require('./smtp.transport')`
// (and transitively `require('nodemailer')`) above this file's own
// top-level statements, so any outer variable referenced inside the
// factory would still be in its TDZ when the factory runs. Same pattern
// as src/features/system/smtp-config.service.spec.ts.
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

import { createTransport } from 'nodemailer';
import { closeSmtpPool, sendMail, verifySmtp } from './smtp.transport';
import type { SmtpConn } from '../email.types';

const mockCreateTransport = createTransport as jest.Mock;
const verify = jest.fn(async () => true);
const sendMailFn = jest.fn(async () => ({ messageId: 'x' }));
const close = jest.fn();
mockCreateTransport.mockReturnValue({ verify, sendMail: sendMailFn, close });

const conn: SmtpConn = {
  host: 'smtp.example.com',
  port: 587,
  secure: true,
  username: 'mailer',
  password: 'pass',
  fromAddress: 'no-reply@example.com',
  fromName: 'Cybernetics',
};

describe('smtp.transport', () => {
  beforeEach(() => {
    mockCreateTransport.mockClear();
    verify.mockClear();
    sendMailFn.mockClear();
    close.mockClear();
  });

  it('verifySmtp builds a transport with auth and calls verify', async () => {
    await verifySmtp(conn);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        auth: { user: 'mailer', pass: 'pass' },
      }),
    );
    expect(verify).toHaveBeenCalled();
    // Pooled now: the transport is reused across sends rather than torn down
    // verifySmtp deliberately does NOT use the pool: an admin testing a
    // config may be testing a broken one, and it should not be cached.
    expect(close).toHaveBeenCalled();
  });

  it('verifySmtp omits auth when there is no username', async () => {
    await verifySmtp({ ...conn, username: null, password: null });
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('sendMail formats the from header and passes text + html + cc', async () => {
    await sendMail(conn, {
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
      cc: 'cc@example.com',
    });
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Cybernetics <no-reply@example.com>',
        to: 'user@example.com',
        cc: 'cc@example.com',
        subject: 'Hi',
        text: 'body',
        html: '<p>body</p>',
      }),
    );
    // Pooled now: the transport is reused across sends rather than torn down
    // after each one, so `close()` is NOT expected here. `verifySmtp` still
    // builds and closes its own, since a config being tested may be wrong.
    expect(close).not.toHaveBeenCalled();
  });

  it('sendMail uses a bare from address when fromName is null', async () => {
    await sendMail(
      { ...conn, fromName: null },
      {
        to: 'user@example.com',
        subject: 'Hi',
        text: 'body',
      },
    );
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'no-reply@example.com' }),
    );
  });

  it('sendMail forwards attachments to the transport', async () => {
    const pdf = Buffer.from('PDFBYTES');
    const png = Buffer.from('PNG');
    const attachments = [
      { filename: 'report.pdf', content: pdf, contentType: 'application/pdf' },
      { filename: 'logo.png', content: png, cid: 'logo@cyb' },
    ];
    await sendMail(conn, {
      to: 'user@example.com',
      subject: 'With files',
      text: 'body',
      attachments,
    });
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({ attachments }),
    );
  });
});

describe('smtp.transport connection pooling', () => {
  beforeEach(() => {
    closeSmtpPool();
    mockCreateTransport.mockClear();
  });

  const conn = {
    host: 'smtp.test',
    port: 587,
    secure: false,
    username: 'u',
    password: 'p',
    fromAddress: 'from@test',
    fromName: null,
  };
  const msg = { to: 'to@test', subject: 's', text: 't' };

  // Every send used to build, connect, send and tear down — a full TCP+TLS+AUTH
  // round trip per message, including on every forgot-password request.
  it('reuses one transport across sends to the same server', async () => {
    await sendMail(conn as never, msg as never);
    await sendMail(conn as never, msg as never);
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it('builds a separate transport when the config changes', async () => {
    await sendMail(conn as never, msg as never);
    await sendMail({ ...conn, host: 'other.test' } as never, msg as never);
    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
  });

  it('asks nodemailer to pool', async () => {
    await sendMail(conn as never, msg as never);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ pool: true }),
    );
  });
});
