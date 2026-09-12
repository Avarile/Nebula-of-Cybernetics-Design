import { INestApplication } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// `@mastra/nestjs` pulls an ESM-only chain that Jest's CJS transform cannot
// load. ChatController's other collaborators import it transitively, and they
// are all stubbed here anyway — same treatment as the mastra unit specs.
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));

import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import type { Principal } from '../src/common/principal';
import { ConfigModule } from '../src/config/config.module';
import { ChatController } from '../src/features/mastra/controllers/chat.controller';
import { ConversationRepository } from '../src/features/mastra/repositories/conversation.repository';
import { AgentRunnerService } from '../src/features/mastra/services/agent-runner.service';
import { ChatStreamService } from '../src/features/mastra/services/chat-stream.service';
import { ConversationMessagesService } from '../src/features/mastra/services/conversation-messages.service';
import { ConversationService } from '../src/features/mastra/services/conversation.service';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';

/**
 * HTTP contract e2e for `GET /agent/conversations`.
 *
 * This is the boundary that broke: the endpoint used to answer with a bare
 * array while the web client reads the `{ data, total, page, limit }` envelope
 * every other paginated list in this API returns, so the chat history rail
 * silently rendered empty forever. Unit tests could not catch it — the shape
 * only disagrees once it crosses HTTP.
 *
 * Boots a focused module (controller + real ConversationService, stubbed
 * repository and Mastra-backed collaborators) rather than AppModule, so it
 * needs neither a database nor Redis. Run with
 * `pnpm test:e2e -- agent-conversations`.
 */
describe('Agent conversations API (e2e)', () => {
  let app: INestApplication;
  let principal: Principal;
  const listByOwner = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ExceptionsModule, LoggerModule],
      controllers: [ChatController],
      providers: [
        ConversationService,
        { provide: ConversationRepository, useValue: { listByOwner } },
        { provide: AgentRunnerService, useValue: {} },
        { provide: ChatStreamService, useValue: {} },
        { provide: ConversationMessagesService, useValue: {} },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Stand in for JwtAuthGuard: the route reads `request.user` via @CurrentUser.
    app.use((req: { user?: Principal }, _res: unknown, next: () => void) => {
      req.user = principal;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    principal = { kind: 'user', userId: 'user-9', role: 'user' };
    listByOwner.mockReset();
    listByOwner.mockResolvedValue({ rows: [], total: 0 });
  });

  it('answers with a paginated envelope, never a bare array', async () => {
    const res = await request(app.getHttpServer())
      .get('/agent/conversations')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual([
      'data',
      'limit',
      'page',
      'total',
    ]);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('serves conversations the client can render, titled and free of internals', async () => {
    listByOwner.mockResolvedValue({
      rows: [
        {
          id: '78cf91a1-94f8-46dd-9309-94f4faffa8de',
          ownerUserId: 'user-9',
          resourceId: 'user-9',
          title: null,
          generatedTitle: 'Friendly Greeting from User',
          kind: 'chat',
          status: 'active',
          lastMessageAt: new Date('2026-07-28T00:30:30Z'),
          messageCount: 2,
          metadata: { internal: true },
          isDeleted: false,
          deletedAt: null,
          createdAt: new Date('2026-07-28T00:30:21Z'),
          updatedAt: new Date('2026-07-28T00:30:30Z'),
        },
      ],
      total: 1,
    });

    const { body } = await request(app.getHttpServer())
      .get('/agent/conversations')
      .expect(200);

    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: '78cf91a1-94f8-46dd-9309-94f4faffa8de',
      title: 'Friendly Greeting from User',
      messageCount: 2,
    });
    expect(body.data[0]).not.toHaveProperty('ownerUserId');
    expect(body.data[0]).not.toHaveProperty('metadata');
    expect(body.data[0]).not.toHaveProperty('isDeleted');
  });

  it('defaults paging to page 1 / limit 20 when unspecified', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/agent/conversations')
      .expect(200);

    expect(body).toMatchObject({ page: 1, limit: 20 });
    expect(listByOwner).toHaveBeenCalledWith('user-9', 1, 20);
  });

  it('coerces page and limit from the query string', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/agent/conversations?page=2&limit=30')
      .expect(200);

    expect(body).toMatchObject({ page: 2, limit: 30 });
    expect(listByOwner).toHaveBeenCalledWith('user-9', 2, 30);
  });

  it('rejects a non-numeric limit instead of passing NaN into SQL', async () => {
    await request(app.getHttpServer())
      .get('/agent/conversations?limit=abc')
      .expect(400);
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it('rejects a limit above the 100 cap', async () => {
    await request(app.getHttpServer())
      .get('/agent/conversations?limit=999999')
      .expect(400);
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it('returns an empty envelope for an anonymous principal', async () => {
    principal = { kind: 'anonymous' };
    const { body } = await request(app.getHttpServer())
      .get('/agent/conversations')
      .expect(200);

    expect(body).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    expect(listByOwner).not.toHaveBeenCalled();
  });
});
