import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { SharedModule } from '../src/features/shared/shared.module';
import { SystemModule } from '../src/features/system/system.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { CacheModule } from '../src/infrastructure/cache/cache.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { FileManageModule } from '../src/infrastructure/file-manage/file-manage.module';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';

/**
 * Phase-0 foundations HTTP contract: tags, comments, attachments, activity, and
 * the system-side feature-flag / retention / event surfaces.
 *
 * Requires Postgres (migrated + seeded), Redis, MinIO and Meilisearch, since
 * SharedModule pulls in FileProcessorModule. Run with
 * `pnpm test:e2e -- shared-foundations`.
 */
describe('Shared foundations (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const adminEmail = `shared_admin_${stamp}@e2e.local`;
  const adminPass = 'shared-admin-e2e-password-123';
  const userEmail = `shared_user_${stamp}@e2e.local`;
  const userPass = 'shared-user-e2e-password-123';
  let adminAccess: string;
  let userAccess: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        // SharedModule -> FileProcessorModule needs OBJECT_STORAGE and the
        // BullMQ connection; AppModule supplies both, a module subset must not
        // assume them.
        CacheModule,
        QueueModule,
        FileManageModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
        SharedModule,
        SystemModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({
      email: adminEmail,
      password: adminPass,
      role: 'admin',
    });
    await users.create({ email: userEmail, password: userPass, role: 'user' });

    adminAccess = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: adminPass })
        .expect(200)
    ).body.accessToken;
    userAccess = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: userPass })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${adminAccess}`);
  const asUser = (r: request.Test) =>
    r.set('Authorization', `Bearer ${userAccess}`);

  describe('tags', () => {
    const key = `e2e_${stamp}`;
    let tagId: string;

    it('requires authentication', async () => {
      await request(server()).get('/tags').expect(401);
    });

    it('lets an admin create one and any user read it', async () => {
      const created = await asAdmin(request(server()).post('/tags'))
        .send({ key, label: 'E2E', scope: 'shared' })
        .expect(201);
      tagId = created.body.id;
      expect(created.body).toMatchObject({
        key,
        scope: 'shared',
        usageCount: 0,
      });

      await asUser(request(server()).get(`/tags/${tagId}`)).expect(200);
    });

    it('forbids a non-admin from creating one', async () => {
      await asUser(request(server()).post('/tags'))
        .send({ key: `${key}_nope`, label: 'Nope', scope: 'shared' })
        .expect(403);
    });

    it('rejects a duplicate key in the same scope', async () => {
      const res = await asAdmin(request(server()).post('/tags'))
        .send({ key, label: 'Dup', scope: 'shared' })
        .expect(409);
      expect(res.body.error.code).toBe('TAG_EXISTS');
    });

    it('refuses to modify a seeded system tag', async () => {
      // Seeded vocabularies are referenced by code; the API must not edit them.
      const listed = await asAdmin(
        request(server()).get('/tags').query({ limit: 100 }),
      ).expect(200);
      const system = listed.body.data.find(
        (t: { isSystem: boolean }) => t.isSystem,
      );
      if (!system) return; // no system tags seeded in this scope yet
      await asAdmin(request(server()).patch(`/tags/${system.id}`))
        .send({ label: 'hijacked' })
        .expect(403);
    });

    it('deletes it', async () => {
      await asAdmin(request(server()).delete(`/tags/${tagId}`)).expect(204);
      await asAdmin(request(server()).get(`/tags/${tagId}`)).expect(404);
    });
  });

  describe('comments on an entity nothing vouches for', () => {
    const body = {
      entityType: 'project',
      entityId: '00000000-0000-4000-8000-000000000001',
      body: 'should not be possible',
      mentionUserIds: [],
    };

    // The fail-closed property: no module has registered a `project` access
    // check yet, so a normal user cannot reach it — and gets 404, not 403,
    // because confirming existence is itself a disclosure.
    it('denies a normal user with NOT_FOUND', async () => {
      const res = await asUser(request(server()).post('/comments'))
        .send(body)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('denies listing them too', async () => {
      await asUser(
        request(server())
          .get('/comments')
          .query({ entityType: 'project', entityId: body.entityId }),
      ).expect(404);
    });

    it('allows an admin, who short-circuits the registry', async () => {
      await asAdmin(request(server()).post('/comments')).send(body).expect(201);
    });
  });

  describe('activity', () => {
    it('scopes /activity/me to the caller, ignoring a spoofed actor filter', async () => {
      const res = await asUser(
        request(server())
          .get('/activity/me')
          // Attempt to read someone else's feed through the query string.
          .query({ actorUserId: '00000000-0000-4000-8000-000000000002' }),
      ).expect(200);
      for (const row of res.body.data) {
        expect(row.actorUserId).not.toBe(
          '00000000-0000-4000-8000-000000000002',
        );
      }
    });

    it('keeps the cross-system feed admin-only', async () => {
      await asUser(request(server()).get('/activity')).expect(403);
      await asAdmin(request(server()).get('/activity')).expect(200);
    });
  });

  describe('system operations', () => {
    it('lists retention policies and reports handler coverage', async () => {
      const res = await asAdmin(
        request(server()).get('/system/retention'),
      ).expect(200);
      const byType = Object.fromEntries(
        res.body.map((p: { entityType: string }) => [p.entityType, p]),
      );
      // Seeded at the agreed window, with the two content tables left off.
      expect(byType['activity_log']).toMatchObject({
        retentionDays: 120,
        enabled: true,
      });
      expect(byType['email_messages'].enabled).toBe(false);
      expect(byType['search_records'].enabled).toBe(false);
    });

    it('keeps retention admin-only', async () => {
      await asUser(request(server()).get('/system/retention')).expect(403);
    });

    it('reads seeded feature flags, all disabled', async () => {
      const res = await asAdmin(
        request(server()).get('/system/feature-flags'),
      ).expect(200);
      const crm = res.body.find((f: { key: string }) => f.key === 'module.crm');
      expect(crm).toMatchObject({ enabled: false });
    });

    it('toggles a flag and reads it back', async () => {
      const key = `e2e.flag.${stamp}`;
      await asAdmin(request(server()).put(`/system/feature-flags/${key}`))
        .send({ enabled: true, rollout: {} })
        .expect(200);
      const res = await asAdmin(
        request(server()).get(`/system/feature-flags/${key}`),
      ).expect(200);
      expect(res.body.enabled).toBe(true);
      await asAdmin(
        request(server()).delete(`/system/feature-flags/${key}`),
      ).expect(204);
    });

    it('records a setting revision and enforces optimistic concurrency', async () => {
      const key = `e2e.setting.${stamp}`;
      await asAdmin(request(server()).put(`/system/settings/${key}`))
        .send({ value: 'first', type: 'string' })
        .expect(200);
      // Second write moves it off version 0, so there is a stale version to hold.
      await asAdmin(request(server()).put(`/system/settings/${key}`))
        .send({ value: 'second', type: 'string' })
        .expect(200);
      const read = await asAdmin(
        request(server()).get(`/system/settings/${key}`),
      ).expect(200);
      expect(read.body.version).toBeGreaterThan(0);

      // A write based on a stale version is refused rather than silently
      // overwriting the other admin's edit.
      const stale = await asAdmin(
        request(server()).put(`/system/settings/${key}`),
      )
        .send({
          value: 'third',
          type: 'string',
          expectedVersion: read.body.version - 1,
        })
        .expect(409);
      expect(stale.body.error.code).toBe('SETTING_VERSION_CONFLICT');

      await asAdmin(request(server()).put(`/system/settings/${key}`))
        .send({
          value: 'third',
          type: 'string',
          expectedVersion: read.body.version,
        })
        .expect(200);
    });
  });
});
