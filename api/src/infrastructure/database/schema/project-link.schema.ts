import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { contactCompanies, contacts } from './contact.schema';
import { invoiceLineItems } from './finance.schema';
import { users } from './identity.schema';
import { knowledge } from './knowledge.schema';
import { projects, tasks } from './project.schema';

/** How a knowledge record relates to the project referencing it. */
export const knowledgeRelation = pgEnum('knowledge_relation', [
  'reference',
  'requirement',
  'deliverable',
  'background',
]);

/** How a contact relates to the project referencing them. */
export const projectContactRelationship = pgEnum(
  'project_contact_relationship',
  ['client', 'stakeholder', 'vendor', 'partner', 'sponsor', 'other'],
);

/**
 * Knowledge referenced by a project.
 *
 * A link does NOT grant access: referencing an article from a project the caller
 * can read does not make the article readable — `knowledge_access_control` still
 * decides, and the UI shows an unreadable reference as a locked stub.
 * Link-implies-grant is the most common way document ACLs leak.
 */
export const projectKnowledgeLinks = pgTable(
  'project_knowledge_links',
  {
    ...baseColumns,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    knowledgeId: uuid('knowledge_id')
      .notNull()
      .references(() => knowledge.id, { onDelete: 'cascade' }),
    /** Optional finer anchor: this article backs THIS task. */
    taskId: uuid('task_id').references(() => tasks.id),
    relation: knowledgeRelation('relation').notNull().default('reference'),
    note: varchar('note', { length: 500 }),
    linkedBy: uuid('linked_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('project_knowledge_links_pair_idx')
      .on(t.projectId, t.knowledgeId, t.relation)
      .where(sql`${t.isDeleted} = false`),
    /** "Where is this article used?" */
    index('project_knowledge_links_knowledge_idx').on(t.knowledgeId),
    index('project_knowledge_links_task_idx').on(t.taskId),
  ],
);

/** Contacts involved in a project. */
export const projectContactLinks = pgTable(
  'project_contact_links',
  {
    ...baseColumns,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /** Snapshotted from the contact at link time: a contact can change employer,
     * and the project's client must not silently change with them. */
    companyId: uuid('company_id').references(() => contactCompanies.id),
    relationship: projectContactRelationship('relationship')
      .notNull()
      .default('stakeholder'),
    isPrimary: boolean('is_primary').notNull().default(false),
    note: varchar('note', { length: 500 }),
    linkedBy: uuid('linked_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('project_contact_links_pair_idx')
      .on(t.projectId, t.contactId, t.relationship)
      .where(sql`${t.isDeleted} = false`),
    uniqueIndex('project_contact_links_primary_idx')
      .on(t.projectId, t.relationship)
      .where(sql`${t.isPrimary} = true AND ${t.isDeleted} = false`),
    index('project_contact_links_contact_idx').on(t.contactId),
  ],
);

/** Logged work — the bridge from project execution to billing. */
export const timeEntries = pgTable(
  'time_entries',
  {
    ...baseColumns,
    /** Null for project-level time with no specific task. */
    taskId: uuid('task_id').references(() => tasks.id),
    /** Denormalized from the task so project reports never join through tasks. */
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    /** The authoritative duration. A stopwatch writes `startedAt` + `minutes`;
     * manual entry writes `minutes` alone. Storing an end time as well invites
     * the two to disagree. */
    minutes: integer('minutes').notNull(),
    /** The day the work is attributed to — not derivable from `startedAt`
     * across time zones and night shifts. */
    workDate: date('work_date').notNull(),
    description: varchar('description', { length: 500 }),
    isBillable: boolean('is_billable').notNull().default(false),
    /** Snapshotted at entry time; rates change and history must not. */
    hourlyRate: numeric('hourly_rate', { precision: 20, scale: 4 }),
    currency: varchar('currency', { length: 3 }),
    /** Presence of this FK is the "already invoiced" lock that stops one hour
     * being billed twice. */
    invoiceLineItemId: uuid('invoice_line_item_id').references(
      () => invoiceLineItems.id,
    ),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (t) => [
    index('time_entries_project_date_idx').on(t.projectId, t.workDate),
    index('time_entries_user_date_idx').on(t.userId, t.workDate),
    index('time_entries_task_idx').on(t.taskId),
    /** The "what can we bill?" query, partial on exactly that predicate. */
    index('time_entries_unbilled_idx')
      .on(t.projectId)
      .where(
        sql`${t.isBillable} = true AND ${t.invoiceLineItemId} IS NULL AND ${t.isDeleted} = false`,
      ),
  ],
);

export type ProjectKnowledgeLinkRow = typeof projectKnowledgeLinks.$inferSelect;
export type NewProjectKnowledgeLinkRow =
  typeof projectKnowledgeLinks.$inferInsert;
export type ProjectContactLinkRow = typeof projectContactLinks.$inferSelect;
export type NewProjectContactLinkRow = typeof projectContactLinks.$inferInsert;
export type TimeEntryRow = typeof timeEntries.$inferSelect;
export type NewTimeEntryRow = typeof timeEntries.$inferInsert;
