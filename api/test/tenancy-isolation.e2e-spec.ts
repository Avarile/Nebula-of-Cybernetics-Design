import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { assertEveryRouteDeclaresPolicy } from '../src/common/route-policy.audit';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { SearchServiceModule } from '../src/features/search-service/search-service.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { CacheModule } from '../src/infrastructure/cache/cache.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';

jest.setTimeout(60_000);

/**
 * Cross-tenant isolation e2e.
 *
 * This suite exists because its absence is what let the leak ship: 544 unit
 * tests and 12 e2e suites, and not one of them checked that user A cannot read
 * user B's data. `search.e2e-spec.ts` actively asserted the opposite.
 *
 * Boots a focused module subset (never AppModule) to avoid the Mastra ESM/Jest
 * break, same as the other search e2e suites. Requires Postgres + Redis +
 * MeiliSearch. Run with `pnpm test:e2e -- tenancy-isolation`.
 */
describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const shared = `shared_${stamp}`;
  const owned = `owned_${stamp}`;
  const secret = `secret_${stamp}`;
  const pass = 'tenancy-e2e-password-123';

  const emails = {
    admin: `tenancy_admin_${stamp}@e2e.local`,
    alice: `tenancy_alice_${stamp}@e2e.local`,
    bob: `tenancy_bob_${stamp}@e2e.local`,
  };
  const tokens: Record<keyof typeof emails, string> = {} as never;
  let aliceId: string;

  const server = () => app.getHttpServer();
  const as = (who: keyof typeof emails, r: request.Test) =>
    r.set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        CacheModule,
        QueueModule,
        SearchEngineModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
        SearchServiceModule,
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
    await users.create({ email: emails.admin, password: pass, role: 'admin' });
    const alice = await users.create({
      email: emails.alice,
      password: pass,
      role: 'user',
    });
    await users.create({ email: emails.bob, password: pass, role: 'user' });
    aliceId = alice.id;

    for (const who of Object.keys(emails) as (keyof typeof emails)[]) {
      const res = await request(server())
        .post('/auth/login')
        .send({ email: emails[who], password: pass })
        .expect(200);
      tokens[who] = res.body.accessToken;
    }

    const ownerField = {
      name: 'ownerUserId',
      type: 'string',
      filterable: true,
    };
    const title = { name: 'title', type: 'string', searchable: true };

    await as('admin', request(server()).post('/search/collections'))
      .send({
        name: shared,
        displayName: 'Shared',
        visibility: 'shared',
        fields: [title],
      })
      .expect(201);

    await as('admin', request(server()).post('/search/collections'))
      .send({
        name: owned,
        displayName: 'Owned',
        visibility: 'owner_scoped',
        ownerField: 'ownerUserId',
        fields: [title, ownerField],
      })
      .expect(201);

    // No explicit visibility — must default to private, not to readable.
    await as('admin', request(server()).post('/search/collections'))
      .send({ name: secret, displayName: 'Secret', fields: [title] })
      .expect(201);

    await as(
      'admin',
      request(server()).post(`/search/collections/${owned}/records?wait=true`),
    )
      .send({
        records: [
          {
            externalId: 'alice-doc',
            document: { title: 'alice private notes', ownerUserId: aliceId },
          },
        ],
      })
      .expect(202);

    await as(
      'admin',
      request(server()).post(`/search/collections/${shared}/records?wait=true`),
    )
      .send({ records: [{ externalId: 's1', document: { title: 'public' } }] })
      .expect(202);
  });

  afterAll(async () => {
    for (const name of [shared, owned, secret]) {
      await as(
        'admin',
        request(server()).delete(`/search/collections/${name}`),
      ).catch(() => undefined);
    }
    await app?.close();
  });

  describe('owner-scoped collections', () => {
    it('returns the owner their own record', async () => {
      const res = await as(
        'alice',
        request(server()).post(`/search/collections/${owned}/query`),
      )
        .send({ q: '' })
        .expect(200);
      expect(res.body.totalHits).toBe(1);
    });

    // The headline case: an empty query is the natural way to enumerate a
    // collection, and it used to return every user's records.
    it('returns nothing to another user, even for an empty query', async () => {
      const res = await as(
        'bob',
        request(server()).post(`/search/collections/${owned}/query`),
      )
        .send({ q: '' })
        .expect(200);
      expect(res.body.totalHits).toBe(0);
      expect(res.body.hits).toEqual([]);
    });

    it('cannot be widened by supplying someone else’s owner filter', async () => {
      const res = await as(
        'bob',
        request(server()).post(`/search/collections/${owned}/query`),
      )
        .send({ q: '', filters: { ownerUserId: aliceId } })
        .expect(200);
      expect(res.body.totalHits).toBe(0);
    });

    it('shows an admin every record', async () => {
      const res = await as(
        'admin',
        request(server()).post(`/search/collections/${owned}/query`),
      )
        .send({ q: '' })
        .expect(200);
      expect(res.body.totalHits).toBe(1);
    });

    // `externalId` is caller-visible (for `documents` it is the fileId), so the
    // single-record read has to be scoped as tightly as the query.
    it('404s a single-record read of another user’s record', async () => {
      await as(
        'bob',
        request(server()).get(`/search/collections/${owned}/records/alice-doc`),
      ).expect(404);
    });

    it('lets the owner read their record by externalId', async () => {
      await as(
        'alice',
        request(server()).get(`/search/collections/${owned}/records/alice-doc`),
      ).expect(200);
    });
  });

  describe('private collections', () => {
    it('403s a query from a non-admin', async () => {
      await as(
        'bob',
        request(server()).post(`/search/collections/${secret}/query`),
      )
        .send({ q: '' })
        .expect(403);
    });

    it('403s a single-record read from a non-admin', async () => {
      await as(
        'bob',
        request(server()).get(`/search/collections/${secret}/records/x`),
      ).expect(403);
    });

    it('allows an admin', async () => {
      await as(
        'admin',
        request(server()).post(`/search/collections/${secret}/query`),
      )
        .send({ q: '' })
        .expect(200);
    });

    it('is the default when a collection declares no visibility', async () => {
      const res = await as(
        'admin',
        request(server()).get(`/search/collections/${secret}`),
      ).expect(200);
      expect(res.body.visibility).toBe('private');
    });
  });

  describe('shared collections', () => {
    it('are readable by any authenticated user', async () => {
      const res = await as(
        'bob',
        request(server()).post(`/search/collections/${shared}/query`),
      )
        .send({ q: '' })
        .expect(200);
      expect(res.body.totalHits).toBe(1);
    });

    it('still require authentication', async () => {
      await request(server())
        .post(`/search/collections/${shared}/query`)
        .send({ q: '' })
        .expect(401);
    });
  });

  describe('route policy', () => {
    // These suites hand-register the guard stack rather than booting AppModule,
    // so nothing here would notice a controller losing its @Roles. The boot
    // audit is what enforces that, and this asserts it actually passes over the
    // module subset under test.
    it('every route in this module subset declares a policy', () => {
      expect(() => assertEveryRouteDeclaresPolicy(app)).not.toThrow();
    });
  });

  describe('collection discovery', () => {
    // A field spec names the filterable and searchable attributes — the
    // reconnaissance step for querying a collection.
    it('is admin-only', async () => {
      await as('bob', request(server()).get('/search/collections')).expect(403);
      await as(
        'bob',
        request(server()).get(`/search/collections/${owned}`),
      ).expect(403);
      await as('admin', request(server()).get('/search/collections')).expect(
        200,
      );
    });
  });

  describe('owner-scoped write validation', () => {
    it('rejects a record with no owner rather than storing an unreadable one', async () => {
      await as(
        'admin',
        request(server()).post(`/search/collections/${owned}/records`),
      )
        .send({ records: [{ document: { title: 'orphan' } }] })
        .expect(400);
    });
  });

  describe('collection policy validation', () => {
    it('rejects owner_scoped without an ownerField', async () => {
      await as('admin', request(server()).post('/search/collections'))
        .send({
          name: `bad_a_${stamp}`,
          displayName: 'Bad',
          visibility: 'owner_scoped',
          fields: [{ name: 'title', type: 'string', searchable: true }],
        })
        .expect(400);
    });

    it('rejects an ownerField that is not filterable', async () => {
      await as('admin', request(server()).post('/search/collections'))
        .send({
          name: `bad_b_${stamp}`,
          displayName: 'Bad',
          visibility: 'owner_scoped',
          ownerField: 'who',
          fields: [
            { name: 'title', type: 'string', searchable: true },
            { name: 'who', type: 'string' },
          ],
        })
        .expect(400);
    });
  });

  describe('service credentials', () => {
    it('cannot reach user-scoped agent routes', async () => {
      const issued = await as(
        'admin',
        request(server()).post('/service-credentials'),
      )
        .send({ name: `tenancy-${stamp}` })
        .expect(201);

      const exchanged = await request(server())
        .post('/auth/service-token')
        .send({ apiKey: issued.body.apiKey })
        .expect(200);
      const agentToken = exchanged.body.accessToken as string;

      // An owner-scoped read has no correct answer for a principal with no
      // owning user, so it is refused rather than silently unscoped.
      await request(server())
        .post(`/search/collections/${owned}/query`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ q: '' })
        .expect(403);

      // Shared collections remain reachable — machine pipelines need them.
      await request(server())
        .post(`/search/collections/${shared}/query`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ q: '' })
        .expect(200);
    });
  });
});
