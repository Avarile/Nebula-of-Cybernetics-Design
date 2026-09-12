import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '../src/config/config.module';
import { SEARCH_ENGINE } from '../src/infrastructure/search-engine/meili.constants';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';
import type { SearchEngine } from '../src/infrastructure/search-engine/search-engine.interface';

/**
 * Integration test against the live MeiliSearch (see MEILISEARCH_* in `.env`).
 * Verifies ensureIndex → addOrReplace → waitForTask → search → filter → clear
 * against a throwaway index. Run with `pnpm test:e2e -- search-engine.e2e`.
 */
jest.setTimeout(30_000);

describe('SearchEngine (integration)', () => {
  let app: INestApplication;
  let engine: SearchEngine;
  const index = 'e2e_docs';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, SearchEngineModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    engine = app.get<SearchEngine>(SEARCH_ENGINE);

    await engine.ensureIndex({
      name: index,
      primaryKey: 'id',
      searchableAttributes: ['title'],
      filterableAttributes: ['ownerId'],
      sortableAttributes: ['rank'],
    });
  });

  afterAll(async () => {
    const cleared = await engine.clearIndex(index);
    await engine.waitForTask(cleared.taskUid);
    await app?.close();
  });

  it('indexes and searches documents', async () => {
    const task = await engine.addOrReplace(index, [
      { id: '1', title: 'hello world', ownerId: 'u1', rank: 1 },
      { id: '2', title: 'goodbye world', ownerId: 'u2', rank: 2 },
    ]);
    await engine.waitForTask(task.taskUid);

    const all = await engine.search(index, {
      q: 'world',
      page: 1,
      hitsPerPage: 20,
    });
    expect(all.totalHits).toBe(2);

    const scoped = await engine.search(index, {
      q: 'world',
      page: 1,
      hitsPerPage: 20,
      filter: ['ownerId = "u1"'],
    });
    expect(scoped.totalHits).toBe(1);
    expect((scoped.hits[0] as { id: string }).id).toBe('1');
  });

  it('reports healthy', async () => {
    expect(await engine.health()).toBe(true);
  });
});
