import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { contacts } from './contact.schema';
import { files } from './file.schema';
import { users } from './identity.schema';
import { roles } from './rbac.schema';
import { tags } from './shared.schema';

export const knowledgeFormat = pgEnum('knowledge_format', [
  'markdown',
  'html',
  'plain',
  'link',
  'file',
]);

export const knowledgeStatus = pgEnum('knowledge_status', [
  'draft',
  'in_review',
  'published',
  'archived',
  'deprecated',
]);

/**
 * Coarse read policy, evaluated before the per-row ACL. Without it, "everyone
 * may read the handbook" would be one grant row per user. `private` is the
 * default for the same fail-closed reason `collections.visibility` is.
 *  - private     — owner + explicit grants + admin
 *  - restricted  — explicit grants only (an owner-less curated record)
 *  - internal    — any authenticated user may read
 */
export const knowledgeVisibility = pgEnum('knowledge_visibility', [
  'private',
  'restricted',
  'internal',
]);

/** Ordered: each level implies the ones before it. */
export const knowledgePermission = pgEnum('knowledge_permission', [
  'read',
  'comment',
  'write',
  'manage',
]);

/** Who a grant is addressed to. */
export const granteeType = pgEnum('grantee_type', [
  'user',
  'role',
  'authenticated',
]);

/** Why a contact is attached to a knowledge record. */
export const knowledgeContactRelation = pgEnum('knowledge_contact_relation', [
  'subject',
  'author',
  'source',
  'expert',
  'mentioned',
]);

/** Curated vocabulary (article, runbook, policy…). */
export const knowledgeTypes = pgTable(
  'knowledge_types',
  {
    ...baseColumns,
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    icon: varchar('icon', { length: 60 }),
    color: varchar('color', { length: 16 }),
    /** Type-level default for `knowledge.reviewDueAt`: a policy needs annual
     * review, a meeting note never does. */
    defaultReviewIntervalDays: integer('default_review_interval_days'),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    uniqueIndex('knowledge_types_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/** Materialized-path tree; see `contact_categories` for the reasoning. */
export const knowledgeCategories = pgTable(
  'knowledge_categories',
  {
    ...baseColumns,
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => knowledgeCategories.id,
    ),
    path: varchar('path', { length: 500 }).notNull().default('/'),
    depth: integer('depth').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    uniqueIndex('knowledge_categories_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('knowledge_categories_path_idx').on(t.path),
    index('knowledge_categories_parent_idx').on(t.parentId),
  ],
);

/**
 * A curated, owned, reviewable article.
 *
 * Distinct from the `documents` search collection, which holds chunks of text
 * extracted from uploaded files: that unit follows its file and is scoped by
 * uploader, this one has a review lifecycle and an ACL. A knowledge row may
 * point at `sourceFileId`, but its body is NOT re-chunked into `documents` —
 * that would index the same text twice and surface one hit as two.
 */
export const knowledge = pgTable(
  'knowledge',
  {
    ...baseColumns,
    title: varchar('title', { length: 500 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    /** Abstract shown in lists and search hits without loading `body`. */
    summary: varchar('summary', { length: 1000 }),
    body: text('body'),
    format: knowledgeFormat('format').notNull().default('markdown'),
    typeId: uuid('type_id').references(() => knowledgeTypes.id),
    categoryId: uuid('category_id').references(() => knowledgeCategories.id),
    status: knowledgeStatus('status').notNull().default('draft'),
    visibility: knowledgeVisibility('visibility').notNull().default('private'),
    /** Bumped on body change; doubles as the optimistic-concurrency token. */
    version: integer('version').notNull().default(1),
    /** Null for agent-ingested records, which run under a non-user principal. */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    authorUserId: uuid('author_user_id').references(() => users.id),
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id),
    sourceUrl: varchar('source_url', { length: 2000 }),
    sourceFileId: uuid('source_file_id').references(() => files.id),
    language: varchar('language', { length: 16 }).notNull().default('en'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Drives `knowledge.review_due`. Stale knowledge is worse than none. */
    reviewDueAt: timestamp('review_due_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Denormalized ranking hint, rebuildable from `activity_log`. */
    viewCount: integer('view_count').notNull().default(0),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('knowledge_slug_idx')
      .on(t.slug)
      .where(sql`${t.isDeleted} = false`),
    index('knowledge_status_idx')
      .on(t.status)
      .where(sql`${t.isDeleted} = false`),
    index('knowledge_category_idx').on(t.categoryId),
    index('knowledge_type_idx').on(t.typeId),
    index('knowledge_owner_idx').on(t.ownerUserId),
    /** Partial on exactly the review sweep's predicate, so the index holds only
     * rows the sweep can act on however large the corpus grows. */
    index('knowledge_review_due_idx')
      .on(t.reviewDueAt)
      .where(sql`${t.reviewDueAt} IS NOT NULL AND ${t.status} = 'published'`),
  ],
);

export const knowledgeTags = pgTable(
  'knowledge_tags',
  {
    ...baseColumns,
    knowledgeId: uuid('knowledge_id')
      .notNull()
      .references(() => knowledge.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    taggedBy: uuid('tagged_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('knowledge_tags_pair_idx')
      .on(t.knowledgeId, t.tagId)
      .where(sql`${t.isDeleted} = false`),
    index('knowledge_tags_tag_idx').on(t.tagId),
  ],
);

/**
 * Row-level grants. GRANT-ONLY: there is no deny.
 *
 * A deny rule makes access an order-dependent evaluation, and "why can this
 * person see this?" stops being a set-membership question. The three needs a
 * deny usually covers are already met: revoke by removing the grant, restrict
 * with `visibility = 'private'`, quarantine with `status = 'archived'`.
 *
 * Resolution (fail-closed): admin and system pass; the owner has `manage`;
 * `internal` visibility grants `read` to any authenticated user; otherwise the
 * highest matching live, unexpired grant wins.
 */
export const knowledgeAccessControl = pgTable(
  'knowledge_access_control',
  {
    ...baseColumns,
    knowledgeId: uuid('knowledge_id')
      .notNull()
      .references(() => knowledge.id, { onDelete: 'cascade' }),
    granteeType: granteeType('grantee_type').notNull(),
    granteeUserId: uuid('grantee_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    granteeRoleId: uuid('grantee_role_id').references(() => roles.id, {
      onDelete: 'cascade',
    }),
    permission: knowledgePermission('permission').notNull().default('read'),
    grantedBy: uuid('granted_by').references(() => users.id),
    /** Time-boxed sharing, filtered at read time and not only by a sweep. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('knowledge_acl_knowledge_idx').on(t.knowledgeId),
    index('knowledge_acl_user_idx')
      .on(t.granteeUserId)
      .where(sql`${t.granteeUserId} IS NOT NULL`),
    index('knowledge_acl_role_idx')
      .on(t.granteeRoleId)
      .where(sql`${t.granteeRoleId} IS NOT NULL`),
    /** Exactly one grantee per row, enforced by the database rather than only
     * by the service that writes it. */
    check(
      'knowledge_acl_grantee_ck',
      sql`(${t.granteeType} = 'user' AND ${t.granteeUserId} IS NOT NULL AND ${t.granteeRoleId} IS NULL)
       OR (${t.granteeType} = 'role' AND ${t.granteeRoleId} IS NOT NULL AND ${t.granteeUserId} IS NULL)
       OR (${t.granteeType} = 'authenticated' AND ${t.granteeUserId} IS NULL AND ${t.granteeRoleId} IS NULL)`,
    ),
  ],
);

/**
 * Contacts a knowledge record is about, by, or sourced from — a meeting note
 * and its attendees, a policy and its owner, research and its interviewee.
 *
 * A link does NOT grant access in either direction: reading the article still
 * requires an ACL grant, and seeing the contact still requires contact scope.
 * Link-implies-grant is the most common way document ACLs leak.
 */
export const knowledgeContactLinks = pgTable(
  'knowledge_contact_links',
  {
    ...baseColumns,
    knowledgeId: uuid('knowledge_id')
      .notNull()
      .references(() => knowledge.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    relation: knowledgeContactRelation('relation').notNull().default('subject'),
    note: varchar('note', { length: 500 }),
    linkedBy: uuid('linked_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('knowledge_contact_links_pair_idx')
      .on(t.knowledgeId, t.contactId, t.relation)
      .where(sql`${t.isDeleted} = false`),
    /** "Everything we know about this person." */
    index('knowledge_contact_links_contact_idx').on(t.contactId),
  ],
);

export type KnowledgeTypeRow = typeof knowledgeTypes.$inferSelect;
export type NewKnowledgeTypeRow = typeof knowledgeTypes.$inferInsert;
export type KnowledgeCategoryRow = typeof knowledgeCategories.$inferSelect;
export type NewKnowledgeCategoryRow = typeof knowledgeCategories.$inferInsert;
export type KnowledgeRow = typeof knowledge.$inferSelect;
export type NewKnowledgeRow = typeof knowledge.$inferInsert;
export type KnowledgeTagRow = typeof knowledgeTags.$inferSelect;
export type NewKnowledgeTagRow = typeof knowledgeTags.$inferInsert;
export type KnowledgeAccessControlRow =
  typeof knowledgeAccessControl.$inferSelect;
export type NewKnowledgeAccessControlRow =
  typeof knowledgeAccessControl.$inferInsert;
export type KnowledgeContactLinkRow = typeof knowledgeContactLinks.$inferSelect;
export type NewKnowledgeContactLinkRow =
  typeof knowledgeContactLinks.$inferInsert;
