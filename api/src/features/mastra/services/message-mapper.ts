export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool';
      toolCallId: string;
      toolName: string;
      state: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    }
  | {
      type: 'source';
      sourceId?: string;
      title?: string;
      url?: string;
      mediaType?: string;
    };

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  parts: ChatMessagePart[];
}

/** Minimal structural view of a Mastra stored message (see @mastra/core message-list types). */
interface DbMessageLike {
  id: string;
  role: string;
  createdAt: Date;
  content?: { parts?: Array<Record<string, unknown> & { type: string }> };
}

/** Pure mapper: Mastra stored messages → the frontend chat DTO. */
export function toChatMessages(dbMessages: DbMessageLike[]): ChatMessageDto[] {
  const out: ChatMessageDto[] = [];
  for (const m of dbMessages) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system')
      continue;
    const parts: ChatMessagePart[] = [];
    for (const part of m.content?.parts ?? []) {
      switch (part.type) {
        case 'text':
          if (typeof part.text === 'string' && part.text.length)
            parts.push({ type: 'text', text: part.text });
          break;
        case 'reasoning': {
          const text =
            (part.text as string) ?? (part.reasoning as string) ?? '';
          if (text) parts.push({ type: 'reasoning', text });
          break;
        }
        case 'tool-invocation': {
          const ti = part.toolInvocation as Record<string, unknown>;
          if (ti) {
            parts.push({
              type: 'tool',
              toolCallId: String(ti.toolCallId ?? ''),
              toolName: String(ti.toolName ?? ''),
              state: String(ti.state ?? ''),
              input: ti.args,
              output: ti.result,
              errorText: ti.errorText as string | undefined,
            });
          }
          break;
        }
        case 'source':
        case 'source-url':
        case 'source-document': {
          const src =
            part.source && typeof part.source === 'object'
              ? (part.source as Record<string, unknown>)
              : part;
          parts.push({
            type: 'source',
            sourceId: (src.id ?? src.sourceId ?? part.sourceId) as
              string | undefined,
            title: (src.title ?? part.title) as string | undefined,
            url: (src.url ?? part.url) as string | undefined,
            mediaType: (src.mediaType ?? src.sourceType ?? part.mediaType) as
              string | undefined,
          });
          break;
        }
        default:
          break; // step-start, file, etc. — ignored in v1
      }
    }
    out.push({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      parts,
    });
  }
  return out;
}
