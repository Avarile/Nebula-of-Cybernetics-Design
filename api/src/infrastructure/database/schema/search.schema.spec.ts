import { collections, searchIndexState, searchRecords } from './search.schema';

describe('search schema', () => {
  it('defines the search_index_state enum', () => {
    expect(searchIndexState.enumValues).toEqual([
      'PENDING',
      'INDEXED',
      'FAILED',
    ]);
  });

  it('exposes the search tables', () => {
    expect(collections).toBeDefined();
    expect(searchRecords).toBeDefined();
  });
});
