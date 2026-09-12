// `@mastra/core/tools`'s cjs build eagerly requires `@sindresorhus/slugify`, which is
// ESM-only (`"type": "module"`) and breaks under Jest's default transformIgnorePatterns.
// The pure `searchQueryExecute` under test never touches `createTool`, so stub it out
// rather than loading the real (currently Jest-incompatible) module.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import type { ToolRuntime } from '../mastra.types';
import { searchQueryExecute } from './search-query.tool';

const engineResult = {
  hits: [{ id: '1', title: 'A' }],
  totalHits: 1,
  page: 1,
  hitsPerPage: 10,
  totalPages: 1,
  processingTimeMs: 1,
  facetDistribution: { status: { live: 1 } },
};

const rt: ToolRuntime = {
  principal: { kind: 'user', userId: 'u-1', role: 'user' },
  runId: 'r1',
  conversationId: 'c1',
};

function deps() {
  return {
    searchRecords: { search: jest.fn(async () => engineResult) },
  } as never;
}

describe('searchQueryExecute', () => {
  it('caps topK at 25 and returns a curated result', async () => {
    const d = deps();
    const out = await searchQueryExecute(
      { collection: 'articles', query: 'a', topK: 999 },
      d,
      rt,
    );
    expect((d as any).searchRecords.search).toHaveBeenCalledWith(
      'articles',
      expect.objectContaining({ q: 'a', limit: 25 }),
      rt.principal,
    );
    expect(out.totalHits).toBe(1);
    expect(out.hits).toHaveLength(1);
    expect(out.facets).toEqual({ status: { live: 1 } });
  });

  it('passes allowlisted filters through', async () => {
    const d = deps();
    await searchQueryExecute(
      {
        collection: 'articles',
        query: '',
        filters: { status: 'live' },
        topK: 5,
      },
      d,
      rt,
    );
    expect((d as any).searchRecords.search).toHaveBeenCalledWith(
      'articles',
      expect.objectContaining({ filters: { status: 'live' }, limit: 5 }),
      rt.principal,
    );
  });

  // Replaces "rejects the private 'documents' collection". The hardcoded ban is
  // gone; the tool now forwards the principal and SearchRecordService decides
  // from the collection's visibility. That closes the real hole the ban only
  // papered over — every OTHER private collection (inbound_email) was readable.
  it('forwards the caller principal so the service can apply the read policy', async () => {
    const d = deps();
    await searchQueryExecute(
      { collection: 'inbound_email', query: '', topK: 10 },
      d,
      rt,
    );
    expect((d as any).searchRecords.search).toHaveBeenCalledWith(
      'inbound_email',
      expect.anything(),
      rt.principal,
    );
  });

  it('propagates a policy refusal from the service rather than swallowing it', async () => {
    const d = {
      searchRecords: {
        search: jest.fn(async () => {
          throw new Error(
            'You do not have access to collection "inbound_email"',
          );
        }),
      },
    } as never;
    await expect(
      searchQueryExecute(
        { collection: 'inbound_email', query: '', topK: 10 },
        d,
        rt,
      ),
    ).rejects.toThrow(/do not have access/);
  });
});
