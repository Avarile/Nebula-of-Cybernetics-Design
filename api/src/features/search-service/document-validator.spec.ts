import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import {
  fieldSpecToIndexDefinition,
  validateDocument,
  validateFieldSpec,
  validateVisibility,
} from './document-validator';

const fields: FieldSpec[] = [
  {
    name: 'title',
    type: 'string',
    required: true,
    searchable: true,
    sortable: true,
  },
  { name: 'body', type: 'string', searchable: true },
  { name: 'tags', type: 'string[]', filterable: true },
  { name: 'price', type: 'number', filterable: true, sortable: true },
  { name: 'status', type: 'string', filterable: true, enum: ['draft', 'live'] },
];

describe('validateFieldSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateFieldSpec(fields)).toEqual([]);
  });

  it('rejects an empty spec', () => {
    expect(validateFieldSpec([]).length).toBeGreaterThan(0);
  });

  it('rejects a reserved field name', () => {
    const errs = validateFieldSpec([
      { name: 'id', type: 'string', searchable: true },
    ]);
    expect(errs.some((e) => e.includes('reserved'))).toBe(true);
  });

  it('rejects a duplicate field name', () => {
    const errs = validateFieldSpec([
      { name: 'a', type: 'string', searchable: true },
      { name: 'a', type: 'number' },
    ]);
    expect(errs.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('rejects searchable on a non-string field', () => {
    const errs = validateFieldSpec([
      { name: 'n', type: 'number', searchable: true },
    ]);
    expect(errs.some((e) => e.includes('searchable'))).toBe(true);
  });

  it('rejects sortable on an array field', () => {
    const errs = validateFieldSpec([
      { name: 't', type: 'string', searchable: true },
      { name: 'x', type: 'string[]', sortable: true },
    ]);
    expect(errs.some((e) => e.includes('sortable'))).toBe(true);
  });

  it('requires at least one searchable field', () => {
    const errs = validateFieldSpec([
      { name: 'n', type: 'number', filterable: true },
    ]);
    expect(errs.some((e) => e.includes('searchable'))).toBe(true);
  });
});

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    expect(
      validateDocument(fields, {
        title: 'Hi',
        tags: ['a'],
        price: 9,
        status: 'live',
      }),
    ).toEqual([]);
  });

  it('flags a missing required field', () => {
    expect(
      validateDocument(fields, { body: 'x' }).some((e) => e.includes('title')),
    ).toBe(true);
  });

  it('flags an unknown field', () => {
    const errs = validateDocument(fields, { title: 'x', nope: 1 });
    expect(errs.some((e) => e.includes('Unknown field "nope"'))).toBe(true);
  });

  it('flags a type mismatch', () => {
    const errs = validateDocument(fields, { title: 123 });
    expect(errs.some((e) => e.includes('title'))).toBe(true);
  });

  it('flags an out-of-enum value', () => {
    const errs = validateDocument(fields, { title: 'x', status: 'archived' });
    expect(errs.some((e) => e.includes('status'))).toBe(true);
  });

  it('flags a bad element in a string[] field', () => {
    const errs = validateDocument(fields, { title: 'x', tags: ['ok', 5] });
    expect(errs.some((e) => e.includes('tags'))).toBe(true);
  });
});

describe('fieldSpecToIndexDefinition', () => {
  it('derives Meili attributes from field flags + system fields', () => {
    const def = fieldSpecToIndexDefinition('articles', fields);
    expect(def).toEqual({
      name: 'articles',
      primaryKey: 'id',
      searchableAttributes: ['title', 'body'],
      filterableAttributes: [
        'tags',
        'price',
        'status',
        'createdAt',
        'updatedAt',
        'externalId',
      ],
      sortableAttributes: ['title', 'price', 'createdAt', 'updatedAt'],
    });
  });
});

describe('validateVisibility', () => {
  const fields: FieldSpec[] = [
    { name: 'title', type: 'string', searchable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'notFilterable', type: 'string' },
    { name: 'count', type: 'number', filterable: true },
  ];

  it('accepts owner_scoped with a string, filterable owner field', () => {
    expect(validateVisibility('owner_scoped', 'ownerUserId', fields)).toEqual(
      [],
    );
  });

  it('accepts private and shared without an owner field', () => {
    expect(validateVisibility('private', null, fields)).toEqual([]);
    expect(validateVisibility('shared', null, fields)).toEqual([]);
  });

  it('rejects owner_scoped without an owner field', () => {
    expect(validateVisibility('owner_scoped', null, fields)).toEqual([
      'An owner_scoped collection must declare an ownerField',
    ]);
  });

  it('rejects an owner field that is not declared in the field spec', () => {
    expect(validateVisibility('owner_scoped', 'nope', fields)).toEqual([
      'ownerField "nope" is not a declared field',
    ]);
  });

  // The read filter the policy emits is `ownerField = "<uuid>"`. Meili rejects a
  // filter on a non-filterable attribute, so an unfilterable owner field would
  // turn every owner-scoped read into a 500 rather than a scoped result.
  it('rejects an owner field that is not filterable', () => {
    expect(validateVisibility('owner_scoped', 'notFilterable', fields)).toEqual(
      ['ownerField "notFilterable" must be filterable'],
    );
  });

  it('rejects a non-string owner field', () => {
    expect(validateVisibility('owner_scoped', 'count', fields)).toEqual([
      'ownerField "count" must be of type string or string[] (is number)',
    ]);
  });

  it('rejects an owner field on a collection that is not owner_scoped', () => {
    expect(validateVisibility('shared', 'ownerUserId', fields)).toEqual([
      'ownerField is only meaningful for an owner_scoped collection (visibility is shared)',
    ]);
  });
});

describe('validateVisibility with an array owner field', () => {
  const aclFields = [
    { name: 'title', type: 'string' as const, searchable: true },
    { name: 'aclUserIds', type: 'string[]' as const, filterable: true },
  ];

  it('accepts a string[] owner field, for ACL-scoped collections', () => {
    // Meilisearch matches `aclUserIds = "<uuid>"` against an array attribute by
    // containment, so the filter resolveReadScope emits works unchanged.
    expect(validateVisibility('owner_scoped', 'aclUserIds', aclFields)).toEqual(
      [],
    );
  });

  it('still requires the array owner field to be filterable', () => {
    const notFilterable = [{ name: 'aclUserIds', type: 'string[]' as const }];
    expect(
      validateVisibility('owner_scoped', 'aclUserIds', notFilterable),
    ).toEqual([expect.stringContaining('filterable')]);
  });

  it('still rejects a type that cannot hold an id', () => {
    const numeric = [
      { name: 'ownerRank', type: 'number' as const, filterable: true },
    ];
    expect(validateVisibility('owner_scoped', 'ownerRank', numeric)).toEqual([
      expect.stringContaining('string or string[]'),
    ]);
  });
});
