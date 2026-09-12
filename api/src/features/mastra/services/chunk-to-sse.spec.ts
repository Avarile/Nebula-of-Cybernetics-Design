import { chunkToSse, sseFrame, actionTypeForTool } from './chunk-to-sse';

describe('chunkToSse', () => {
  it('maps text and reasoning deltas', () => {
    expect(
      chunkToSse({
        type: 'text-delta',
        payload: { id: '1', text: 'Hel' },
      } as never),
    ).toEqual({ type: 'text-delta', delta: 'Hel' });
    expect(
      chunkToSse({
        type: 'reasoning-delta',
        payload: { id: '1', text: 'hmm' },
      } as never),
    ).toEqual({ type: 'reasoning-delta', delta: 'hmm' });
  });

  it('maps tool-call and tool-result', () => {
    expect(
      chunkToSse({
        type: 'tool-call',
        payload: {
          toolCallId: 't1',
          toolName: 'search-documents',
          args: { q: 'x' },
        },
      } as never),
    ).toEqual({
      type: 'tool-input',
      toolCallId: 't1',
      toolName: 'search-documents',
      args: { q: 'x' },
    });
    expect(
      chunkToSse({
        type: 'tool-result',
        payload: {
          toolCallId: 't1',
          toolName: 'search-documents',
          result: { totalHits: 0 },
          isError: false,
        },
      } as never),
    ).toEqual({
      type: 'tool-output',
      toolCallId: 't1',
      toolName: 'search-documents',
      result: { totalHits: 0 },
      isError: false,
    });
  });

  it('ignores chunks with no client-facing mapping', () => {
    expect(chunkToSse({ type: 'step-start', payload: {} } as never)).toBeNull();
    expect(chunkToSse({ type: 'finish', payload: {} } as never)).toBeNull();
  });

  it('frames an event as an SSE data line and maps action types', () => {
    expect(sseFrame({ type: 'done', status: 'succeeded' })).toBe(
      'data: {"type":"done","status":"succeeded"}\n\n',
    );
    expect(actionTypeForTool('send-email')).toBe('send_email');
    expect(actionTypeForTool('db-write')).toBe('db_write');
    expect(actionTypeForTool('mystery')).toBe('other');
  });
});
