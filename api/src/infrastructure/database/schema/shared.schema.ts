import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { serviceCredentials, users } from './identity.schema';
import { files } from './file.schema';

/**
 * Which domain a tag belongs to. One vocabulary table serves every module so
 * "urgent" is a single row with a single id — the alternative (a tag table per
 * domain) makes a cross-domain facet a three-way union of unrelated ids.
 * `shared` is usable from any module.
 */
export const tagScope = pgEnum('tag_scope', [
  'knowledge',
  'contact',
  'project',
  'task',
  'shared',
]);

/** Entities that accept comments. An enum, not free text: see `comments`. */
export const commentableType = pgEnum('commentable_type', [
  'project',
  'task',
  'goal',
  'milestone',
  'knowledge',
  'contact',
  'invoice',
]);

/** Entities that accept file attachments. */
export const attachableType = pgEnum('attachable_type', [
  'project',
  'task',
  'knowledge',
  'contact',
  'contact_company',
  'invoice',
  'transaction',
]);

/** Coarse grouping for attachment UIs. */
export const attachmentKind = pgEnum('attachment_kind', [
  'document',
  'image',
  'receipt',
  'contract',
  'other',
]);

/**
 * Who acted. Mirrors the non-anonymous arms of the `Principal` union in
 * `common/principal.ts`; an anonymous caller cannot produce an activity row
 * because every activity-producing route requires authentication.
 */
export const actorKind = pgEnum('actor_kind', ['user', 'service', 'system']);

/** Subjects an activity row can describe. */
export const activityEntityType = pgEnum('activity_entity_type', [
  'project',
  'task',
  'goal',
  'milestone',
  'knowledge',
  'contact',
  'contact_company',
  'invoice',
  'transaction',
  'user',
  'system',
]);

/**
 * Shared tag vocabulary. Each domain joins to it through its own explicit join
 * table (`knowledge_tags`, `contact_tags`, `project_tags`, `task_tags`) rather
 * than one polymorphic `taggings` table: a polymorphic join cannot carry a
 * foreign key, so deleting a tagged row would silently orphan its taggings.
 */
export const tags = pgTable(
  'tags',
  {
    ...baseColumns,
    key: varchar('key', { length: 80 }).notNull(), // slug, lowercased
    label: varchar('label', { length: 120 }).notNull(),
    scope: tagScope('scope').notNull().default('shared'),
    color: varchar('color', { length: 16 }),
    description: varchar('description', { length: 500 }),
    /**
     * Denormalized facet-ordering hint, maintained by the tag service and
     * rebuildable by a sweep. Never authoritative — nothing may branch on it.
     */
    usageCount: integer('usage_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    uniqueIndex('tags_scope_key_idx')
      .on(t.scope, t.key)
      .where(sql`${t.isDeleted} = false`),
    index('tags_scope_usage_idx').on(t.scope, t.usageCount),
  ],
);

/**
 * Comments on any commentable entity.
 *
 * One of only two deliberately polymorphic tables (with `entity_attachments`):
 * a comment has identical shape and no per-pair semantics wherever it hangs, so
 * seven near-identical tables would buy nothing. `entity_type` is an enum rather
 * than free text, and the cost — no FK, application-level cascade — is accepted
 * here and refused everywhere else in the schema.
 */
export const comments = pgTable(
  'comments',
  {
    ...baseColumns,
    entityType: commentableType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(), // no FK: polymorphic by design
    parentCommentId: uuid('parent_comment_id').references(
      (): AnyPgColumn => comments.id,
    ),
    /** Null for agent/system-authored comments; `authorKind` disambiguates. */
    authorUserId: uuid('author_user_id').references(() => users.id),
    authorKind: actorKind('author_kind').notNull().default('user'),
    body: text('body').notNull(),
    /**
     * Resolved `users.id` list driving mention notifications. Written by the
     * service after resolving handles — never accepted from the client, which
     * would let a caller address a notification to anyone.
     */
    mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    index('comments_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('comments_author_idx').on(t.authorUserId),
    index('comments_parent_idx').on(t.parentCommentId),
  ],
);

/**
 * Binds any entity to a row in `files` (MinIO holds the bytes). This is what
 * serves "project documents" — there is no separate project_documents table.
 */
export const entityAttachments = pgTable(
  'entity_attachments',
  {
    ...baseColumns,
    entityType: attachableType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(), // no FK: polymorphic by design
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    label: varchar('label', { length: 255 }),
    kind: attachmentKind('kind').notNull().default('document'),
    attachedBy: uuid('attached_by').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('entity_attachments_unique_idx')
      .on(t.entityType, t.entityId, t.fileId)
      .where(sql`${t.isDeleted} = false`),
    index('entity_attachments_entity_idx').on(t.entityType, t.entityId),
    /**
     * Reverse lookup. The orphaned-upload sweep must answer "is this file still
     * referenced?" without scanning every table that can hold an attachment.
     */
    index('entity_attachments_file_idx').on(t.fileId),
  ],
);

/**
 * User-facing activity feed. Append-only, so no `baseColumns` — a log row that
 * can be soft-deleted is not a record of what happened.
 *
 * Distinct from `system_audit_log`, which answers "who changed system
 * configuration?" for compliance with redacted metadata, is admin-only, and is
 * retained far longer. This one answers "what happened to this record?", is
 * readable by whoever may read the subject entity, and carries before/after
 * values for business fields (never secrets, hashes or tokens).
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorKind: actorKind('actor_kind').notNull().default('user'),
    /**
     * Set when `actor_kind = 'service'`. Separate from `actor_user_id` because a
     * `service_credentials.id` is not a `users.id` and writing one into that
     * column violates the foreign key (see `common/principal.ts`).
     */
    actorCredentialId: uuid('actor_credential_id').references(
      () => serviceCredentials.id,
    ),
    entityType: activityEntityType('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: varchar('action', { length: 100 }).notNull(),
    summary: varchar('summary', { length: 500 }),
    changes: jsonb('changes')
      .$type<Record<string, { from: unknown; to: unknown }>>()
      .notNull()
      .default({}),
    /**
     * Denormalized scope key so a project feed is one index scan instead of a
     * union across every entity type. Deliberately no FK: this is an append-only
     * log that must outlive the rows it describes (same reasoning as
     * `agent_action_log.conversation_id`).
     */
    projectId: uuid('project_id'),
    requestId: varchar('request_id', { length: 64 }),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
  },
  (t) => [
    index('activity_log_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('activity_log_project_idx').on(t.projectId, t.createdAt),
    index('activity_log_actor_idx').on(t.actorUserId, t.createdAt),
    index('activity_log_created_idx').on(t.createdAt), // retention sweep
  ],
);

export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;
export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
export type EntityAttachmentRow = typeof entityAttachments.$inferSelect;
export type NewEntityAttachmentRow = typeof entityAttachments.$inferInsert;
export type ActivityLogRow = typeof activityLog.$inferSelect;
export type NewActivityLogRow = typeof activityLog.$inferInsert;
