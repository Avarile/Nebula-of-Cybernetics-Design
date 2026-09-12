// The mock factory below must be self-contained (no references to outer
// `const`/`let` bindings): @swc/jest hoists `require('./transport/smtp.transport')`
// above this file's own top-level statements, so any outer variable
// referenced inside the factory would still be in its TDZ when the factory
// runs. Same pattern as ./transport/smtp.transport.spec.ts — configure the
// mocks after importing them instead of closing over outer consts.
jest.mock('./transport/smtp.transport', () => ({
  sendMail: jest.fn(async () => undefined),
  verifySmtp: jest.fn(async () => undefined),
}));

import { sendMail, verifySmtp } from './transport/smtp.transport';
import { MailerService } from './mailer.service';
import { NoActiveEmailConfigError } from './email.types';

const mockSendMail = sendMail as jest.Mock;
const mockVerifySmtp = verifySmtp as jest.Mock;

const conn = {
  host: 'h',
  port: 587,
  secure: true,
  username: 'u',
  password: 'p',
  fromAddress: 'no-reply@x.com',
  fromName: null,
};

describe('MailerService', () => {
  let repo: any;
  let service: MailerService;

  beforeEach(() => {
    mockSendMail.mockClear();
    mockVerifySmtp.mockClear();
    repo = { activeSmtp: jest.fn(async () => conn), activeImap: jest.fn() };
    service = new MailerService(repo);
  });

  it('send resolves the active config and delegates to transport', async () => {
    const msg = { to: 'a@x.com', subject: 'Hi', text: 'body' };
    await service.send(msg);
    expect(repo.activeSmtp).toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledWith(conn, msg);
  });

  it('send throws NoActiveEmailConfigError when none is active', async () => {
    repo.activeSmtp.mockResolvedValueOnce(null);
    await expect(
      service.send({ to: 'a@x.com', subject: 'Hi', text: 'body' }),
    ).rejects.toBeInstanceOf(NoActiveEmailConfigError);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('verifyActive delegates to verifySmtp', async () => {
    await service.verifyActive();
    expect(mockVerifySmtp).toHaveBeenCalledWith(conn);
  });
});
