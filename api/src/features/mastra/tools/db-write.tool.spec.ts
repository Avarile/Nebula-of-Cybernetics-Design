// See send-email.tool.spec.ts for why @mastra/core/tools is stubbed under Jest.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import { dbWriteExecute } from './db-write.tool';
import type { ToolRuntime } from '../mastra.types';

describe('dbWriteExecute', () => {
  it('records the intended write as a db_write action (v1 pattern)', async () => {
    const deps = { recordAction: jest.fn(async () => undefined) } as never;
    const rt: ToolRuntime = {
      principal: { kind: 'user', userId: 'u1', role: 'user' },
      runId: 'r1',
      conversationId: 'c1',
    };
    const out = await dbWriteExecute(
      { entity: 'note', operation: 'create', data: { text: 'x' } },
      deps,
      rt,
    );
    expect(out.accepted).toBe(true);
    expect((deps as any).recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'db_write',
        status: 'success',
        toolId: 'db-write',
      }),
    );
  });
});
