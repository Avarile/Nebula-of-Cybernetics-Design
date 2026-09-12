import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { RolesGuard } from '../src/common/guards/roles.guard';
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
import {
  MEILI_CLIENT,
  SEARCH_ENGINE,
} from '../src/infrastructure/search-engine/meili.constants';
import type { MeiliSearch } from 'meilisearch';
import type { SearchEngine } from '../src/infrastructure/search-engine/search-engine.interface';
import { SearchIndexingProcessor } from '../src/features/search-service/processors/search-indexing.processor';
import {
  RECONCILE_JOB,
  SEARCH_INDEXING_QUEUE,
} from '../src/features/search-service/search.constants';

// Set before the app boots, so the config factory picks it up: the sweep must
// treat a just-written record as already stale, or the reconciliation test
// below would have to wait out the real five-minute threshold.
process.env.SEARCH_RECONCILE_STALE_MS = '1';

// Indexing is asynchronous and several tests poll for convergence against live
// Postgres + Redis + Meili, which does not fit the 5s default.
jest.setTimeout(60_000);

/**
 * Search data-processor e2e. Boots a focused module subset (never AppModule) to
 * avoid the Mastra ESM/Jest break. Requires Postgres + Redis + MeiliSearch.
 * Run with `pnpm test:e2e -- search.e2e`.
 */
describe('Search Management API (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const collection = `articles_${stamp}`;
  const adminEmail = `search_admin_${stamp}@e2e.local`;
  const userEmail = `search_user_${stamp}@e2e.local`;
  const pass = 'search-e2e-password-123';
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        // Supplies REDIS_CLIENT, which IndexRegistry uses to broadcast
        // collection-cache invalidations across instances.
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
        // AppModule registers this globally; without it here the DTO-level
        // field-spec rules never run, so an invalid spec would be accepted.
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({ email: adminEmail, password: pass, role: 'admin' });
    await users.create({ email: userEmail, password: pass, role: 'user' });

    const login = async (email: string) =>
      (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: pass })
          .expect(200)
      ).body.accessToken;
    adminToken = await login(adminEmail);
    userToken = await login(userEmail);
  });

  afterAll(async () => {
    // Delete the collection this run created — it also drops the Meili index.
    // Without this every run leaks a collection, which is how three orphaned
    // indexes accumulated and started failing the reconciliation sweep.
    if (app && adminToken) {
      await asAdmin(
        request(server()).delete(`/search/collections/${collection}`),
      ).catch(() => undefined);
    }
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${adminToken}`);
  const asUser = (r: request.Test) =>
    r.set('Authorization', `Bearer ${userToken}`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Poll until `check` is true. Returns false if it never became true. */
  const waitFor = async (check: () => Promise<boolean>): Promise<boolean> => {
    for (let i = 0; i < 100; i++) {
      if (await check().catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  };

  it('rejects unauthenticated collection creation', async () => {
    await request(server()).post('/search/collections').send({}).expect(401);
  });

  it('forbids a non-admin from creating a collection', async () => {
    await asUser(request(server()).post('/search/collections'))
      .send({
        name: collection,
        displayName: 'Articles',
        fields: [{ name: 'title', type: 'string', searchable: true }],
      })
      .expect(403);
  });

  it('lets an admin create a collection', async () => {
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: collection,
        displayName: 'Articles',
        // Declared shared on purpose: the rest of this suite queries as a
        // non-admin to exercise filters, paging and reload. Collections now
        // default to `private`, so without this every `asUser` query below
        // would 403 — the fixture states the intent rather than the policy
        // being weakened to accommodate the test.
        visibility: 'shared',
        fields: [
          {
            name: 'title',
            type: 'string',
            required: true,
            searchable: true,
            sortable: true,
          },
          {
            name: 'status',
            type: 'string',
            filterable: true,
            enum: ['draft', 'live'],
          },
        ],
      })
      .expect(201);
  });

  it('rejects an invalid field-spec (no searchable field)', async () => {
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: `bad_${stamp}`,
        displayName: 'Bad',
        fields: [{ name: 'n', type: 'number', filterable: true }],
      })
      .expect(400);
  });

  it('forbids a non-admin from persisting records', async () => {
    await asUser(
      request(server()).post(`/search/collections/${collection}/records`),
    )
      .send({ records: [{ document: { title: 'x' } }] })
      .expect(403);
  });

  it('400s a document that fails validation', async () => {
    await asAdmin(
      request(server()).post(`/search/collections/${collection}/records`),
    )
      .send({ records: [{ document: { title: 123 } }] })
      .expect(400);
  });

  it('persists records (202) and makes them queryable after indexing', async () => {
    await asAdmin(
      request(server()).post(`/search/collections/${collection}/records`),
    )
      .send({
        records: [
          {
            externalId: 'a1',
            document: { title: 'Hello world', status: 'live' },
          },
          {
            externalId: 'a2',
            document: { title: 'Draft note', status: 'draft' },
          },
        ],
      })
      .expect(202);

    // Indexing is async; poll briefly for eventual consistency.
    let hits = 0;
    for (let i = 0; i < 20 && hits === 0; i++) {
      await sleep(250);
      const res = await asUser(
        request(server()).post(`/search/collections/${collection}/query`),
      ).send({ q: 'hello' });
      if (res.status === 200) hits = res.body.totalHits;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('lets a user filter on an allowlisted field', async () => {
    const res = await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: '', filters: { status: 'live' } })
      .expect(200);
    expect(
      res.body.hits.every((h: { status: string }) => h.status === 'live'),
    ).toBe(true);
  });

  it('rejects a filter on a non-allowlisted field', async () => {
    await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: '', filters: { title: 'x' } })
      .expect(400);
  });

  it('404s querying an unknown collection', async () => {
    await asUser(
      request(server()).post('/search/collections/does_not_exist/query'),
    )
      .send({ q: 'x' })
      .expect(404);
  });

  it('lets an admin reload a collection', async () => {
    const before = await asAdmin(
      request(server()).get(`/search/collections/${collection}/records/a1`),
    ).expect(200);
    const indexedAtBefore = before.body.indexedAt;

    await asAdmin(
      request(server()).post(`/search/collections/${collection}/reload`),
    ).expect(202);

    // A reload is a destructive rebuild (clear, then repage from Postgres) that
    // runs off the request path. Wait for it to finish: leaving it in flight
    // would race every later test, since its `clearIndex` can wipe a document
    // another test just wrote.
    //
    // Hit count is useless as a completion signal — the index already holds
    // these documents, so it is satisfied before the rebuild even starts. The
    // rebuild restamps `indexedAt` on every record it writes, so watch that.
    expect(
      await waitFor(async () => {
        const res = await asAdmin(
          request(server()).get(`/search/collections/${collection}/records/a1`),
        );
        return res.status === 200 && res.body.indexedAt !== indexedAtBefore;
      }),
    ).toBe(true);

    const rebuilt = await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: '' })
      .expect(200);
    expect(rebuilt.body.totalHits).toBe(2);
  });

  it('forbids a non-admin from reloading', async () => {
    await asUser(
      request(server()).post(`/search/collections/${collection}/reload`),
    ).expect(403);
  });

  it('settles synchronously when the caller passes ?wait=true', async () => {
    const res = await asAdmin(
      request(server()).post(
        `/search/collections/${collection}/records?wait=true`,
      ),
    )
      .send({ records: [{ externalId: 'w1', document: { title: 'Waited' } }] })
      .expect(202);
    expect(res.body[0].indexState).toBe('INDEXED');

    const query = await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: 'waited' })
      .expect(200);
    expect(query.body.totalHits).toBeGreaterThan(0);
  });

  // Regression test for the silent-corruption case: if the Meili volume is
  // wiped while the app runs, `addDocuments` auto-creates an index with default
  // settings — writes succeed, records stamp INDEXED, and every filter then
  // fails at query time. The indexer must reapply the collection's settings.
  it('recreates a vanished index with its configured filterable attributes', async () => {
    const engine = app.get<SearchEngine>(SEARCH_ENGINE);
    const dropped = await engine.deleteIndex(collection);
    await engine.waitForTask(dropped.taskUid);

    await asAdmin(
      request(server()).post(
        `/search/collections/${collection}/records?wait=true`,
      ),
    )
      .send({
        records: [
          { externalId: 'r1', document: { title: 'Rebuilt', status: 'live' } },
        ],
      })
      .expect(202);

    // A filter on `status` is only legal if the settings were reapplied; on a
    // default-settings index Meili rejects it and this would 503.
    const res = await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: '', filters: { status: 'live' } })
      .expect(200);
    expect(res.body.totalHits).toBeGreaterThan(0);
  });

  // Regression for the failure seen in production logs: "primary key inference
  // failed as the engine found 2 fields ending with `id`". An index auto-created
  // by a document write has no primary key, and `ensureIndex` cannot add one
  // afterwards — so without an explicit primary key on writes, every retry fails
  // identically and the record is stuck forever.
  it('heals an index that was auto-created without a primary key', async () => {
    const engine = app.get<SearchEngine>(SEARCH_ENGINE);
    const client = app.get<MeiliSearch>(MEILI_CLIENT);

    // Its own collection, not the suite's shared one. The indexing worker is
    // live in this app, and it calls `ensureIndex` — which DOES set a primary
    // key — whenever a job for a collection lands. Running against the shared
    // collection meant an earlier test's in-flight job could recreate the index
    // between the delete below and the assertion, so the keyless precondition
    // held only some of the time and the heal assertion then passed on Meili's
    // work rather than ours.
    const healing = `healing_${stamp}`;
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: healing,
        displayName: 'Healing',
        visibility: 'shared',
        fields: [
          { name: 'title', type: 'string', required: true, searchable: true },
        ],
      })
      .expect(201);

    const uid = `${process.env.MEILISEARCH_INDEX_PREFIX ?? ''}${healing}`;
    const dropped = await engine.deleteIndex(healing);
    await engine.waitForTask(dropped.taskUid);

    // Recreate the exact broken state: a raw document write with no primary key
    // and two `*id` fields. Meili creates the index first, then fails inference,
    // leaving the index permanently keyless.
    const seeded = await client
      .index(uid)
      .addDocuments([{ id: 'seed-1', externalId: 'seed-ext-1' }]);
    // Wait for the write to settle, not merely for the index to exist: the
    // primary key is only final once Meili has finished processing the task.
    await client.waitForTask(seeded.taskUid);
    expect((await client.index(uid).getRawInfo()).primaryKey).toBeNull();

    // A normal persist must now repair it rather than fail forever.
    const res = await asAdmin(
      request(server()).post(
        `/search/collections/${healing}/records?wait=true`,
      ),
    )
      .send({ records: [{ externalId: 'pk1', document: { title: 'Healed' } }] })
      .expect(202);
    expect(res.body[0].indexState).toBe('INDEXED');
    expect((await client.index(uid).getRawInfo()).primaryKey).toBe('id');

    const query = await asUser(
      request(server()).post(`/search/collections/${healing}/query`),
    )
      .send({ q: 'healed' })
      .expect(200);
    expect(query.body.totalHits).toBeGreaterThan(0);
  });

  // The core durability guarantee: a record whose handoff to Redis never landed
  // must still converge. Before the reconciliation sweep was wired up, this
  // record would have stayed PENDING and invisible to search forever.
  it('reconciliation indexes a record whose handoff was lost', async () => {
    const queue = app.get<Queue>(getQueueToken(SEARCH_INDEXING_QUEUE));
    const add = jest
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('redis down'));

    const persisted = await asAdmin(
      request(server()).post(`/search/collections/${collection}/records`),
    )
      .send({
        records: [{ externalId: 'lost', document: { title: 'Orphan' } }],
      })
      // The write is committed, so a failed handoff is not a failed request.
      .expect(202);
    expect(persisted.body[0].indexState).toBe('PENDING');

    add.mockRestore();
    const before = await asAdmin(
      request(server()).get(`/search/collections/${collection}/records/lost`),
    ).expect(200);
    expect(before.body.indexState).toBe('PENDING');

    // Run the sweep the scheduler would have run, then let the worker drain it.
    await app.get(SearchIndexingProcessor).process({
      name: RECONCILE_JOB,
      data: {},
    } as never);

    let record: { indexState: string; indexError: string | null } = {
      indexState: 'PENDING',
      indexError: null,
    };
    for (let i = 0; i < 40 && record.indexState !== 'INDEXED'; i++) {
      await sleep(250);
      const res = await asAdmin(
        request(server()).get(`/search/collections/${collection}/records/lost`),
      );
      if (res.status === 200) record = res.body as typeof record;
    }
    expect({ state: record.indexState, error: record.indexError }).toEqual({
      state: 'INDEXED',
      error: null,
    });
  });

  it('reports index sync status to an admin', async () => {
    const res = await asAdmin(
      request(server()).get(`/search/collections/${collection}/sync-status`),
    ).expect(200);
    expect(res.body).toMatchObject({
      collection,
      degraded: false,
      counts: expect.objectContaining({ indexed: expect.any(Number) }),
    });
    expect(res.body.counts.indexed).toBeGreaterThan(0);
  });

  it('forbids a non-admin from reading sync status', async () => {
    await asUser(request(server()).get('/search/sync-status')).expect(403);
  });
});
