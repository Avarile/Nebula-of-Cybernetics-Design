import type {
  CollectionVisibility,
  FieldSpec,
  FieldType,
} from '../../infrastructure/database/schema/search.schema';
import type { IndexDefinition } from '../../infrastructure/search-engine/search-engine.interface';
import { RECORD_PRIMARY_KEY } from './search.constants';

/** System field names on the Meili doc; a field-spec may not reuse them. */
export const RESERVED_FIELD_NAMES: readonly string[] = [
  'id',
  'externalId',
  'collection',
  'createdAt',
  'updatedAt',
];

const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const SCALAR_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

/** Validate the field-spec itself. Returns human-readable errors (empty = valid). */
export function validateFieldSpec(fields: FieldSpec[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(fields) || fields.length === 0) {
    return ['A collection must declare at least one field'];
  }
  const seen = new Set<string>();
  for (const f of fields) {
    if (!FIELD_NAME_RE.test(f.name)) {
      errors.push(`Invalid field name "${f.name}"`);
    }
    if (RESERVED_FIELD_NAMES.includes(f.name)) {
      errors.push(`"${f.name}" is a reserved field name`);
    }
    if (seen.has(f.name)) errors.push(`Duplicate field "${f.name}"`);
    seen.add(f.name);
    if (f.searchable && f.type !== 'string' && f.type !== 'string[]') {
      errors.push(`Field "${f.name}" cannot be searchable (type ${f.type})`);
    }
    if (f.sortable && !SCALAR_TYPES.includes(f.type)) {
      errors.push(`Field "${f.name}" cannot be sortable (type ${f.type})`);
    }
  }
  if (!fields.some((f) => f.searchable)) {
    errors.push('At least one field must be searchable');
  }
  return errors;
}

/**
 * Validate a collection's read policy against its own field spec.
 *
 * An `owner_scoped` collection is read through a `<ownerField> = "<userId>"`
 * filter, so the field it names has to be one Meili can actually filter on and
 * one that holds a `users.id`. Checking that here — beside `validateFieldSpec`,
 * and called from both the DTO and `CollectionService` — is what stops the
 * policy and the index configuration from drifting apart, the same discipline
 * `fieldSpecToIndexDefinition` applies to attributes.
 */
export function validateVisibility(
  visibility: CollectionVisibility,
  ownerField: string | null | undefined,
  fields: FieldSpec[],
): string[] {
  if (visibility !== 'owner_scoped') {
    return ownerField
      ? [
          `ownerField is only meaningful for an owner_scoped collection (visibility is ${visibility})`,
        ]
      : [];
  }
  if (!ownerField) {
    return ['An owner_scoped collection must declare an ownerField'];
  }
  const spec = fields.find((f) => f.name === ownerField);
  if (!spec) {
    return [`ownerField "${ownerField}" is not a declared field`];
  }
  const errors: string[] = [];
  // `string[]` as well as `string`: an ACL-scoped collection scopes reads by an
  // ARRAY of permitted user ids, not a single owner, and Meilisearch matches
  // `field = value` against an array attribute by containment. `resolveReadScope`
  // needs no change — the filter it emits is correct for both shapes.
  if (spec.type !== 'string' && spec.type !== 'string[]') {
    errors.push(
      `ownerField "${ownerField}" must be of type string or string[] (is ${spec.type})`,
    );
  }
  if (!spec.filterable) {
    errors.push(`ownerField "${ownerField}" must be filterable`);
  }
  return errors;
}

/** Validate a document payload against a field-spec. Returns errors (empty = valid). */
export function validateDocument(
  fields: FieldSpec[],
  doc: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const allowed = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(doc)) {
    if (!allowed.has(key)) errors.push(`Unknown field "${key}"`);
  }
  for (const f of fields) {
    const value = doc[f.name];
    if (value === undefined || value === null) {
      if (f.required) errors.push(`Missing required field "${f.name}"`);
      continue;
    }
    if (!matchesType(f.type, value)) {
      errors.push(`Field "${f.name}" must be of type ${f.type}`);
      continue;
    }
    if (f.enum && !inEnum(f.enum, value)) {
      errors.push(`Field "${f.name}" must be one of: ${f.enum.join(', ')}`);
    }
  }
  return errors;
}

/** Derive the Meili attribute config from a field-spec. One source of truth. */
export function fieldSpecToIndexDefinition(
  name: string,
  fields: FieldSpec[],
): IndexDefinition {
  return {
    name,
    primaryKey: RECORD_PRIMARY_KEY,
    searchableAttributes: fields.filter((f) => f.searchable).map((f) => f.name),
    filterableAttributes: [
      ...fields.filter((f) => f.filterable).map((f) => f.name),
      'createdAt',
      'updatedAt',
      'externalId',
    ],
    sortableAttributes: [
      ...fields.filter((f) => f.sortable).map((f) => f.name),
      'createdAt',
      'updatedAt',
    ],
  };
}

function matchesType(type: FieldType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'number[]':
      return (
        Array.isArray(value) &&
        value.every((v) => typeof v === 'number' && Number.isFinite(v))
      );
  }
}

function inEnum(allowed: Array<string | number>, value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every((v) => allowed.includes(v as string | number));
  }
  return allowed.includes(value as string | number);
}
