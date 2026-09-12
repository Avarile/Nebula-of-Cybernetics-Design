import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import { files } from './file.schema';
import { users } from './identity.schema';
import { emailMessages } from './mailbox.schema';
import { projects } from './project.schema';
import { tags } from './shared.schema';

/** Shared by contacts and companies. */
export const contactStatus = pgEnum('contact_status', [
  'active',
  'inactive',
  'archived',
  'do_not_contact',
]);

/** Provenance, for data-quality triage. */
export const contactSource = pgEnum('contact_source', [
  'manual',
  'inbound_email',
  'import',
  'referral',
  'website',
  'agent',
]);

/** `private` = owner + admin; `shared` = any authenticated user. */
export const contactVisibility = pgEnum('contact_visibility', [
  'private',
  'shared',
]);

export const contactChannelKind = pgEnum('contact_channel_kind', [
  'email',
  'phone',
  'mobile',
  'fax',
  'website',
  'linkedin',
  'twitter',
  'wechat',
  'whatsapp',
  'other',
]);

export const companySize = pgEnum('company_size', [
  'micro',
  'small',
  'medium',
  'large',
  'enterprise',
]);

export const contactRelationshipType = pgEnum('contact_relationship_type', [
  'colleague',
  'reports_to',
  'manages',
  'spouse',
  'family',
  'friend',
  'referred_by',
  'introduced_by',
  'advisor_to',
  'other',
]);

export const relationshipStrength = pgEnum('relationship_strength', [
  'weak',
  'moderate',
  'strong',
]);

export const interactionKind = pgEnum('interaction_kind', [
  'email_in',
  'email_out',
  'call',
  'meeting',
  'note',
  'task',
  'other',
]);

export const interactionDirection = pgEnum('interaction_direction', [
  'inbound',
  'outbound',
  'internal',
]);

/** Curated vocabulary (lead, client, supplier…). A table, not an enum: admins
 * extend it without a migration, and `key` gives code a stable handle. */
export const contactTypes = pgTable(
  'contact_types',
  {
    ...baseColumns,
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    color: varchar('color', { length: 16 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    uniqueIndex('contact_types_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * Segmentation tree. `path` is a materialized path (`/root/child`), so subtree
 * filtering is an index range scan rather than a recursion per query; the cost
 * is a bounded subtree rewrite when a node moves. Cycles are rejected by
 * checking the prospective parent's `path` for the moving node's id.
 */
export const contactCategories = pgTable(
  'contact_categories',
  {
    ...baseColumns,
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => contactCategories.id,
    ),
    path: varchar('path', { length: 500 }).notNull().default('/'),
    depth: integer('depth').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    uniqueIndex('contact_categories_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('contact_categories_path_idx').on(t.path),
    index('contact_categories_parent_idx').on(t.parentId),
  ],
);

/** Organizations. `domain` is the natural key for email-domain matching. */
export const contactCompanies = pgTable(
  'contact_companies',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),
    legalName: varchar('legal_name', { length: 255 }),
    domain: varchar('domain', { length: 255 }),
    industry: varchar('industry', { length: 120 }),
    size: companySize('size'),
    website: varchar('website', { length: 255 }),
    phone: varchar('phone', { length: 40 }),
    /** Displayed, not filtered — `country` is duplicated out for reporting. */
    address: jsonb('address')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    country: varchar('country', { length: 2 }),
    parentCompanyId: uuid('parent_company_id').references(
      (): AnyPgColumn => contactCompanies.id,
    ),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    status: contactStatus('status').notNull().default('active'),
    description: text('description'),
    logoFileId: uuid('logo_file_id').references(() => files.id),
    /** Used by invoicing. */
    taxNumber: varchar('tax_number', { length: 60 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('contact_companies_domain_idx')
      .on(t.domain)
      .where(sql`${t.domain} IS NOT NULL AND ${t.isDeleted} = false`),
    index('contact_companies_name_idx').on(t.name),
    index('contact_companies_owner_idx').on(t.ownerUserId),
    index('contact_companies_parent_idx').on(t.parentCompanyId),
  ],
);

/** People. Referenced by knowledge, projects and finance. */
export const contacts = pgTable(
  'contacts',
  {
    ...baseColumns,
    firstName: varchar('first_name', { length: 120 }),
    lastName: varchar('last_name', { length: 120 }),
    /** Stored, not computed: organizations and mononyms break first + last, and
     * the search projection needs one stable field. */
    displayName: varchar('display_name', { length: 255 }).notNull(),
    salutation: varchar('salutation', { length: 40 }),
    /** Denormalized from `contact_channels` for list rendering; the channel row
     * remains authoritative. */
    primaryEmail: varchar('primary_email', { length: 320 }),
    /**
     * Lowercased, trimmed `primaryEmail`, maintained by the service. Uniqueness
     * here is what makes deduplication AUTOMATIC: an ingest that meets a known
     * address upserts the existing contact instead of creating a twin.
     *
     * The accepted consequence is that a shared address (`info@`, a family
     * account) resolves to a single contact. Where two real people must share
     * one address, give the second an empty `primaryEmail` and record the
     * address as a non-primary `contact_channels` row.
     */
    emailNormalized: varchar('email_normalized', { length: 320 }),
    primaryPhone: varchar('primary_phone', { length: 40 }),
    jobTitle: varchar('job_title', { length: 150 }),
    companyId: uuid('company_id').references(() => contactCompanies.id),
    typeId: uuid('type_id').references(() => contactTypes.id),
    categoryId: uuid('category_id').references(() => contactCategories.id),
    /** The relationship owner. Null for pipeline-created contacts (inbound
     * email, agent), which run under a non-user principal. */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    /** Set when this contact is also a system user. */
    linkedUserId: uuid('linked_user_id').references(() => users.id),
    status: contactStatus('status').notNull().default('active'),
    source: contactSource('source').notNull().default('manual'),
    visibility: contactVisibility('visibility').notNull().default('private'),
    address: jsonb('address')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    country: varchar('country', { length: 2 }),
    timezone: varchar('timezone', { length: 64 }),
    language: varchar('language', { length: 16 }),
    /** `date`, not `timestamptz` — a birthday has no time zone. */
    birthday: date('birthday'),
    notes: text('notes'),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true }),
    avatarFileId: uuid('avatar_file_id').references(() => files.id),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    uniqueIndex('contacts_email_normalized_idx')
      .on(t.emailNormalized)
      .where(sql`${t.emailNormalized} IS NOT NULL AND ${t.isDeleted} = false`),
    uniqueIndex('contacts_linked_user_idx')
      .on(t.linkedUserId)
      .where(sql`${t.linkedUserId} IS NOT NULL AND ${t.isDeleted} = false`),
    index('contacts_owner_idx')
      .on(t.ownerUserId)
      .where(sql`${t.isDeleted} = false`),
    index('contacts_company_idx').on(t.companyId),
    index('contacts_status_idx').on(t.status),
    index('contacts_display_name_idx').on(t.displayName),
    index('contacts_follow_up_idx')
      .on(t.nextFollowUpAt)
      .where(sql`${t.nextFollowUpAt} IS NOT NULL`),
  ],
);

/** Multi-valued contact points. */
export const contactChannels = pgTable(
  'contact_channels',
  {
    ...baseColumns,
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    kind: contactChannelKind('kind').notNull(),
    /** Emails stored lowercased, matching `users.email`. */
    value: varchar('value', { length: 320 }).notNull(),
    label: varchar('label', { length: 60 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    /** Channel-level opt-out, checked by the notification send path. */
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contact_channels_value_idx')
      .on(t.contactId, t.kind, t.value)
      .where(sql`${t.isDeleted} = false`),
    uniqueIndex('contact_channels_primary_idx')
      .on(t.contactId, t.kind)
      .where(sql`${t.isPrimary} = true AND ${t.isDeleted} = false`),
    /** Resolves an inbound message's From address to a contact in one lookup. */
    index('contact_channels_value_lookup_idx').on(t.kind, t.value),
  ],
);

export const contactTags = pgTable(
  'contact_tags',
  {
    ...baseColumns,
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    taggedBy: uuid('tagged_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('contact_tags_pair_idx')
      .on(t.contactId, t.tagId)
      .where(sql`${t.isDeleted} = false`),
    index('contact_tags_tag_idx').on(t.tagId),
  ],
);

/**
 * The person-to-person edge set. Directed and stored once: symmetric types
 * (`colleague`, `spouse`) are rendered from either side by the service, because
 * storing both directions doubles the rows and lets them disagree.
 */
export const contactRelationships = pgTable(
  'contact_relationships',
  {
    ...baseColumns,
    fromContactId: uuid('from_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    toContactId: uuid('to_contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    type: contactRelationshipType('type').notNull(),
    strength: relationshipStrength('strength'),
    since: date('since'),
    note: varchar('note', { length: 500 }),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('contact_relationships_edge_idx')
      .on(t.fromContactId, t.toContactId, t.type)
      .where(sql`${t.isDeleted} = false`),
    index('contact_relationships_to_idx').on(t.toContactId),
    check(
      'contact_relationships_no_self_ck',
      sql`${t.fromContactId} <> ${t.toContactId}`,
    ),
  ],
);

/**
 * Touchpoint timeline. The `email_message_id` join is what makes the existing
 * IMAP ingest pay off: every stored inbound message becomes a timeline entry on
 * the right contact, and the partial unique index makes that idempotent, so a
 * mailbox re-sync cannot create a second entry for the same message.
 */
export const contactInteractions = pgTable(
  'contact_interactions',
  {
    ...baseColumns,
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    kind: interactionKind('kind').notNull(),
    /** The event time, not the row time. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    subject: varchar('subject', { length: 500 }),
    /** Notes in full; for email a snippet, since the body lives in `email_messages`. */
    body: text('body'),
    direction: interactionDirection('direction'),
    emailMessageId: uuid('email_message_id').references(() => emailMessages.id),
    projectId: uuid('project_id').references(() => projects.id),
    userId: uuid('user_id').references(() => users.id),
    durationMinutes: integer('duration_minutes'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('contact_interactions_contact_idx').on(t.contactId, t.occurredAt),
    index('contact_interactions_project_idx').on(t.projectId, t.occurredAt),
    uniqueIndex('contact_interactions_email_idx')
      .on(t.emailMessageId)
      .where(sql`${t.emailMessageId} IS NOT NULL AND ${t.isDeleted} = false`),
  ],
);

export type ContactTypeRow = typeof contactTypes.$inferSelect;
export type NewContactTypeRow = typeof contactTypes.$inferInsert;
export type ContactCategoryRow = typeof contactCategories.$inferSelect;
export type NewContactCategoryRow = typeof contactCategories.$inferInsert;
export type ContactCompanyRow = typeof contactCompanies.$inferSelect;
export type NewContactCompanyRow = typeof contactCompanies.$inferInsert;
export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
export type ContactChannelRow = typeof contactChannels.$inferSelect;
export type NewContactChannelRow = typeof contactChannels.$inferInsert;
export type ContactTagRow = typeof contactTags.$inferSelect;
export type NewContactTagRow = typeof contactTags.$inferInsert;
export type ContactRelationshipRow = typeof contactRelationships.$inferSelect;
export type NewContactRelationshipRow =
  typeof contactRelationships.$inferInsert;
export type ContactInteractionRow = typeof contactInteractions.$inferSelect;
export type NewContactInteractionRow = typeof contactInteractions.$inferInsert;
