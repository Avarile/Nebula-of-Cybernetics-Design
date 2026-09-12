import { createCollectionSchema } from './create-collection.dto';
import { persistRecordsSchema } from './persist-records.dto';

describe('createCollectionSchema', () => {
  const base = {
    name: 'articles',
    displayName: 'Articles',
    fields: [{ name: 'title', type: 'string', searchable: true }],
  };

  it('accepts a valid collection', () => {
    expect(createCollectionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an invalid name', () => {
    expect(
      createCollectionSchema.safeParse({ ...base, name: 'Bad Name' }).success,
    ).toBe(false);
  });

  it('rejects a spec with no searchable field (via validateFieldSpec)', () => {
    const res = createCollectionSchema.safeParse({
      ...base,
      fields: [{ name: 'n', type: 'number', filterable: true }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects a reserved field name', () => {
    const res = createCollectionSchema.safeParse({
      ...base,
      fields: [{ name: 'id', type: 'string', searchable: true }],
    });
    expect(res.success).toBe(false);
  });
});

describe('persistRecordsSchema', () => {
  it('accepts a batch of records', () => {
    const res = persistRecordsSchema.safeParse({
      records: [
        { externalId: 'a', document: { title: 'x' } },
        { document: { title: 'y' } },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(persistRecordsSchema.safeParse({ records: [] }).success).toBe(false);
  });
});
