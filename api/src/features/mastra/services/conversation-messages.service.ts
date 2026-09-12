import { Injectable } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import type { PrincipalRef } from '../mastra.types';
import { ConversationService } from './conversation.service';
import { toChatMessages, type ChatMessageDto } from './message-mapper';

@Injectable()
export class ConversationMessagesService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly mastra: MastraService,
  ) {}

  async list(
    principal: PrincipalRef,
    conversationId: string,
  ): Promise<ChatMessageDto[]> {
    const conv = await this.conversations.getOwned(principal, conversationId);
    const store = this.mastra.getMastra().getStorage();
    const memory = await store?.getStore('memory');
    if (!memory) return [];
    const { messages } = await memory.listMessages({
      threadId: conv.id,
      resourceId: conv.resourceId,
    });
    return toChatMessages(messages);
  }
}
