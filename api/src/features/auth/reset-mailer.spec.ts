import { ResetMailer } from './reset-mailer';

describe('ResetMailer', () => {
  let mailer: any;
  let reset: ResetMailer;

  beforeEach(() => {
    mailer = { send: jest.fn(async () => undefined) };
    reset = new ResetMailer(mailer);
  });

  it('sendCode emails the code to the user', async () => {
    await reset.sendCode('user@example.com', '482913');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('reset code'),
        text: expect.stringContaining('482913'),
      }),
    );
    const arg = mailer.send.mock.calls[0][0];
    expect(arg.html).toContain('482913');
  });

  it('sendChangedConfirmation emails a confirmation (no code)', async () => {
    await reset.sendChangedConfirmation('user@example.com');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('changed'),
        text: expect.stringContaining('changed'),
      }),
    );
  });
});
