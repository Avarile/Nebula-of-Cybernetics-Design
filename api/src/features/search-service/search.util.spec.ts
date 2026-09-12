import type { SearchRecordRow } from '../../infrastructure/database/schema/search.schema';
import { computeChecksum, toMeiliDocument } from './search.util';

describe('computeChecksum', () => {
  it('is stable regardless of document key order', () => {
    const a = computeChecksum('x', { a: 1, b: 2 });
    const b = computeChecksum('x', { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('changes when the document changes', () => {
    expect(computeChecksum('x', { a: 1 })).not.toBe(
      computeChecksum('x', { a: 2 }),
    );
  });

  it('changes when the externalId changes', () => {
    expect(computeChecksum('x', { a: 1 })).not.toBe(
      computeChecksum('y', { a: 1 }),
    );
  });
});

describe('toMeiliDocument', () => {
  const row = {
    id: 'rec-1',
    collection: 'articles',
    externalId: 'ext-1',
    document: { title: 'Hi', tags: ['a'] },
    checksum: 'c',
    indexState: 'PENDING',
    indexError: null,
    indexedAt: null,
    indexAttemptedAt: null,
    indexAttempts: 0,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  } as SearchRecordRow;

  it('spreads the document with system fields and epoch timestamps', () => {
    expect(toMeiliDocument(row)).toEqual({
      id: 'rec-1',
      externalId: 'ext-1',
      title: 'Hi',
      tags: ['a'],
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
      updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    });
  });

  it('omits externalId when absent', () => {
    const doc = toMeiliDocument({ ...row, externalId: null });
    expect('externalId' in doc).toBe(false);
  });
});
