// See search-query.tool.spec.ts for why `@mastra/core/tools` is stubbed here.
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));

import { searchDocumentsExecute } from './search-documents.tool';
import { DOCUMENTS_COLLECTION } from '../../document-ingest/document-ingest.constants';

describe('searchDocumentsExecute', () => {
  // The tool no longer builds the owner filter itself — `documents` is declared
  // `owner_scoped` and SearchRecordService injects it from the principal. What
  // this asserts now is that the principal is HANDED OVER, which is what makes
  // the scoping happen at all.
  it('targets the documents collection and forwards the caller principal', async () => {
    const search = jest.fn().mockResolvedValue({
      totalHits: 1,
      hits: [{ title: 'a' }],
      facetDistribution: undefined,
    });
    const principal = {
      kind: 'user',
      userId: 'user-1',
      role: 'user',
    } as const;
    const res = await searchDocumentsExecute(
      { query: 'invoice', topK: 5 },
      { searchRecords: { search } },
      { principal, conversationId: 'c1', runId: 'r1' },
    );
    const [collection, req, passedPrincipal] = search.mock.calls[0];
    expect(collection).toBe(DOCUMENTS_COLLECTION);
    expect(req.q).toBe('invoice');
    expect(passedPrincipal).toEqual(principal);
    // No hand-rolled owner filter any more; the service owns that decision.
    expect(req.filters).toBeUndefined();
    expect(res.totalHits).toBe(1);
  });

  it('returns an empty result when there is no principal id', async () => {
    const search = jest.fn();
    const res = await searchDocumentsExecute(
      { query: '', topK: 5 },
      { searchRecords: { search } },
      { principal: { kind: 'anonymous' }, conversationId: null, runId: null },
    );
    expect(search).not.toHaveBeenCalled();
    expect(res.totalHits).toBe(0);
    expect(res.hits).toEqual([]);
  });
});
