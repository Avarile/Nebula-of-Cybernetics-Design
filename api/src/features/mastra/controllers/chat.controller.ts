import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { Principal } from '../../../common/principal';
import { ChatDto } from '../dto/chat.dto';
import { ChatStreamDto } from '../dto/chat-stream.dto';
import { ListConversationsDto } from '../dto/list-conversations.dto';
import { AgentRunnerService } from '../services/agent-runner.service';
import { ChatStreamService } from '../services/chat-stream.service';
import { ConversationMessagesService } from '../services/conversation-messages.service';
import { ConversationService } from '../services/conversation.service';

@ApiTags('Agent')
// Service credentials (role 'agent') are deliberately excluded: their token's
// `sub` is a service_credentials.id, and agent_conversation.owner_user_id has a
// foreign key to users.id, so a machine caller here is an FK violation, not a
// feature. Add an owner_credential_id column first if machine chat is needed.
@Roles('user', 'admin')
@Controller('agent')
export class ChatController {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly chatStream: ChatStreamService,
    private readonly conversations: ConversationService,
    private readonly conversationMessages: ConversationMessagesService,
  ) {}

  @ApiOperation({ summary: 'Send chat message to agent' })
  @Post('chat')
  chat(@CurrentUser() user: Principal, @Body() dto: ChatDto) {
    return this.runner.runChat(user, dto);
  }

  @ApiOperation({ summary: 'Stream a chat turn (SSE)' })
  @Post('chat/stream')
  async stream(
    @CurrentUser() user: Principal,
    @Body() dto: ChatStreamDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    await this.chatStream.stream(user, dto, { write: (f) => res.write(f) });
    res.end();
  }

  @ApiOperation({ summary: 'List agent conversations' })
  @Get('conversations')
  list(@CurrentUser() user: Principal, @Query() query: ListConversationsDto) {
    return this.conversations.listForOwner(user, query.page, query.limit);
  }

  @ApiOperation({ summary: 'Get messages for a conversation' })
  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversationMessages.list(user, id);
  }
}
