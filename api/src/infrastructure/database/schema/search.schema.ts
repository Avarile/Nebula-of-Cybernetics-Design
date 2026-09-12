import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';

/** Primitive field types a collection document may declare. */
export type FieldType =
  'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]';

/**
 * One field in a collection's schema. The per-field flags drive BOTH write-time
 * validation AND the Meili attribute config, so the two can never drift.
 */
export interface FieldSpec {
  name: string;
  type: FieldType;
  required?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  enum?: Array<string | number>;
}

/** Sync state of a record vs. its Meili document (a lightweight outbox marker). */
export const searchIndexState = pgEnum('search_index_state', [
  'PENDING',
  'INDEXED',
  'FAILED',
]);

/**
 * Who may READ a collection's records. Write access is unrelated and stays
 * admin-only (`RecordController`).
 *
 * The default is `private` on purpose. The search-service is a generic store
 * that other features write per-user data into (`documents`, `inbound_email`),
 * and a permissive default is how those became world-readable: a collection
 * that never declared a policy was served to every authenticated caller. A
 * collection that forgets to declare one is now admin-only instead.
 *
 *  - `private`      — admin only.
 *  - `owner_scoped` — a non-admin sees only records whose `ownerField` holds
 *                     their own `users.id`. Requires `ownerField`.
 *  - `shared`       — any authenticated principal may read. Opt-in.
 */
export const collectionVisibility = pgEnum('collection_visibility', [
  'private',
  'owner_scoped',
  'shared',
]);

/** TS mirror of the {@link collectionVisibility} enum. */
export type CollectionVisibility =
  (typeof collectionVisibility.enumValues)[number];

/**
 * A dynamic, admin-managed collection (logical Meili index). `name` is the
 * immutable identity used in URLs and as the Meili index name (the engine adds
 * the configured prefix). `fields` is the field-spec that governs validation
 * and Meili attributes.
 */
export const collections = pgTable(
  'collections',
  {
    ...baseColumns,
    name: varchar('name', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: varchar('description', { length: 500 }),
    fields: jsonb('fields').$type<FieldSpec[]>().notNull().default([]),
    visibility: collectionVisibility('visibility').notNull().default('private'),
    /**
     * For `owner_scoped` collections: the document field holding the owning
     * `users.id`. Validated against `fields` (must exist, be `string`, and be
     * `filterable`) so the read filter the policy emits can never reference an
     * attribute Meili cannot filter on.
     */
    ownerField: varchar('owner_field', { length: 100 }),
  },
  (t) => [
    uniqueIndex('collections_name_idx')
      .on(t.name)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * A persisted record. Postgres is the source of truth; Meili is a rebuildable
 * read model. `id` is the Meili document primary key. `externalId` is the
 * caller's optional business key enabling idempotent upsert. `checksum` detects
 * unchanged re-writes. `indexState` is the outbox marker reconciliation repairs.
 *
 * Sync bookkeeping is deliberately split from `updatedAt`:
 *  - `updatedAt` means "the record's content changed" and is never touched by
 *    indexing, so `updatedAt > indexedAt` is a truthful drift predicate.
 *  - `indexAttemptedAt` means "we last tried to index it" and is what the
 *    reconciliation sweep orders and filters by.
 *  - `indexAttempts` counts tries, so a permanently stuck record is visible
 *    rather than merely inferred.
 */
export const searchRecords = pgTable(
  'search_records',
  {
    ...baseColumns,
    collection: varchar('collection', { length: 100 }).notNull(),
    externalId: varchar('external_id', { length: 255 }),
    document: jsonb('document')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    indexState: searchIndexState('index_state').notNull().default('PENDING'),
    indexError: varchar('index_error', { length: 1000 }),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    indexAttemptedAt: timestamp('index_attempted_at', { withTimezone: true }),
    indexAttempts: integer('index_attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('search_records_collection_external_idx')
      .on(t.collection, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL AND ${t.isDeleted} = false`),
    index('search_records_collection_deleted_idx').on(
      t.collection,
      t.isDeleted,
    ),
    index('search_records_collection_state_idx').on(t.collection, t.indexState),
    // The reconciliation sweep's exact predicate. Partial, so the index only
    // ever holds unconverged rows — it stays tiny no matter how large the table.
    index('search_records_unsynced_idx')
      .on(t.indexAttemptedAt)
      .where(sql`${t.indexState} <> 'INDEXED'`),
    // The purge sweep's predicate: soft-deleted rows whose removal Meili confirmed.
    index('search_records_purgeable_idx')
      .on(t.deletedAt)
      .where(sql`${t.isDeleted} = true AND ${t.indexState} = 'INDEXED'`),
  ],
);

export type CollectionRow = typeof collections.$inferSelect;
export type NewCollectionRow = typeof collections.$inferInsert;
export type SearchRecordRow = typeof searchRecords.$inferSelect;
export type NewSearchRecordRow = typeof searchRecords.$inferInsert;
