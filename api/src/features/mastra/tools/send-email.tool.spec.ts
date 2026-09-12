// `@mastra/core/tools`'s cjs build eagerly requires `@sindresorhus/slugify`, which is
// ESM-only (`"type": "module"`) and breaks under Jest's default transformIgnorePatterns.
// The pure `sendEmailExecute` under test never touches `createTool`, so stub it out
// rather than loading the real (currently Jest-incompatible) module.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import { sendEmailExecute } from './send-email.tool';
import type { ToolRuntime } from '../mastra.types';

describe('sendEmailExecute', () => {
  const rt: ToolRuntime = {
    principal: { kind: 'user', userId: 'u1', role: 'user' },
    runId: 'r1',
    conversationId: 'c1',
  };

  it('sends then records a success action', async () => {
    const d = {
      sendEmail: jest.fn(async () => undefined),
      recordAction: jest.fn(async () => undefined),
    } as never;
    const out = await sendEmailExecute(
      { to: 'a@b.com', subject: 'Hi', body: 'Body' },
      d,
      rt,
    );
    expect((d as any).sendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      cc: undefined,
    });
    expect((d as any).recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'send_email',
        status: 'success',
        runId: 'r1',
      }),
    );
    expect(out.sent).toBe(true);
  });

  it('records a failed action and rethrows on transport error', async () => {
    const d = {
      sendEmail: jest.fn(async () => {
        throw new Error('smtp down');
      }),
      recordAction: jest.fn(async () => undefined),
    } as never;
    await expect(
      sendEmailExecute({ to: 'a@b.com', subject: 'Hi', body: 'B' }, d, rt),
    ).rejects.toThrow('smtp down');
    expect((d as any).recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
