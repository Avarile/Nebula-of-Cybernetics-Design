import { toChatMessages } from './message-mapper';

describe('toChatMessages', () => {
  it('maps text, reasoning and tool-invocation parts, dropping step-start', () => {
    const db = [
      {
        id: 'm1',
        role: 'user',
        createdAt: new Date('2026-01-01'),
        content: { format: 2, parts: [{ type: 'text', text: 'hi' }] },
      },
      {
        id: 'm2',
        role: 'assistant',
        createdAt: new Date('2026-01-02'),
        content: {
          format: 2,
          parts: [
            { type: 'step-start' },
            { type: 'reasoning', text: 'thinking' },
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'result',
                toolName: 'search-documents',
                toolCallId: 't1',
                args: { query: 'x' },
                result: { totalHits: 0 },
              },
            },
            { type: 'text', text: 'done' },
          ],
        },
      },
    ];
    const out = toChatMessages(db as never);
    expect(out[0]).toMatchObject({
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    });
    expect(out[1].parts.map((p) => p.type)).toEqual([
      'reasoning',
      'tool',
      'text',
    ]);
    const tool = out[1].parts.find((p) => p.type === 'tool') as Record<
      string,
      unknown
    >;
    expect(tool).toMatchObject({
      toolName: 'search-documents',
      toolCallId: 't1',
      state: 'result',
    });
    expect(typeof out[1].createdAt).toBe('string');
  });

  it('maps nested bare "source" and flat "source-document" parts, keeping fields populated', () => {
    const db = [
      {
        id: 'm3',
        role: 'assistant',
        createdAt: new Date('2026-01-03'),
        content: {
          format: 2,
          parts: [
            {
              type: 'source',
              source: {
                id: 's1',
                url: 'https://example.com',
                title: 'Example',
                sourceType: 'url',
              },
            },
            {
              type: 'source-document',
              sourceId: 'd1',
              title: 'Doc',
              mediaType: 'application/pdf',
            },
          ],
        },
      },
    ];
    const out = toChatMessages(db as never);
    expect(out[0].parts).toHaveLength(2);

    const nestedSource = out[0].parts[0] as Record<string, unknown>;
    expect(nestedSource).toMatchObject({
      type: 'source',
      sourceId: 's1',
      url: 'https://example.com',
      title: 'Example',
    });
    expect(nestedSource.sourceId).not.toBeUndefined();
    expect(nestedSource.title).not.toBeUndefined();

    const flatSource = out[0].parts[1] as Record<string, unknown>;
    expect(flatSource).toMatchObject({
      type: 'source',
      sourceId: 'd1',
      title: 'Doc',
      mediaType: 'application/pdf',
    });
    expect(flatSource.sourceId).not.toBeUndefined();
    expect(flatSource.title).not.toBeUndefined();
  });

  it('ignores signal-role messages', () => {
    const db = [
      {
        id: 's',
        role: 'signal',
        createdAt: new Date(),
        content: { format: 2, parts: [] },
      },
    ];
    expect(toChatMessages(db as never)).toEqual([]);
  });
});
