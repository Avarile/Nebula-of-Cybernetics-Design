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
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { users } from './identity.schema';

export const conversationKind = pgEnum('agent_conversation_kind', [
  'chat',
  'scheduled',
  'event',
]);
export const conversationStatus = pgEnum('agent_conversation_status', [
  'active',
  'archived',
]);
export const runTrigger = pgEnum('agent_run_trigger', [
  'user_message',
  'schedule',
  'event',
  'api',
]);
export const runStatus = pgEnum('agent_run_status', [
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
]);
export const actionType = pgEnum('agent_action_type', [
  'send_email',
  'db_write',
  'external_api',
  'other',
]);
export const approvalStatus = pgEnum('agent_approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
  'executed',
  'failed',
]);
export const actionStatus = pgEnum('agent_action_status', [
  'success',
  'failed',
]);
export const deliveryChannel = pgEnum('agent_schedule_delivery', [
  'conversation',
  'email',
  'none',
]);

/** Thin metadata over a Mastra thread; `id` IS the Mastra thread id. Stores no messages. */
export const agentConversations = pgTable(
  'agent_conversation',
  {
    ...baseColumns,
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    resourceId: text('resource_id').notNull(),
    title: varchar('title', { length: 500 }),
    kind: conversationKind('kind').notNull().default('chat'),
    status: conversationStatus('status').notNull().default('active'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index('agent_conversation_owner_idx')
      .on(t.ownerUserId)
      .where(sql`${t.isDeleted} = false`),
    index('agent_conversation_resource_idx').on(t.resourceId),
    index('agent_conversation_kind_status_idx').on(t.kind, t.status),
  ],
);

/** Ledger of every agent invocation. */
export const agentRuns = pgTable(
  'agent_run',
  {
    ...baseColumns,
    conversationId: uuid('conversation_id').references(
      () => agentConversations.id,
    ),
    trigger: runTrigger('trigger').notNull(),
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),
    status: runStatus('status').notNull().default('queued'),
    input: jsonb('input')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<{
      message: string;
      code?: string;
      category?: string;
    }>(),
    attempts: integer('attempts').notNull().default(0),
    mastraRunId: text('mastra_run_id'),
    agentId: text('agent_id').notNull(),
    model: text('model'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    latencyMs: integer('latency_ms'),
  },
  (t) => [
    index('agent_run_conversation_idx').on(t.conversationId),
    index('agent_run_status_idx').on(t.status),
    index('agent_run_trigger_idx').on(t.trigger),
    index('agent_run_mastra_run_idx').on(t.mastraRunId),
  ],
);

/** Pending human-in-the-loop decisions. */
export const agentApprovals = pgTable(
  'agent_approval',
  {
    ...baseColumns,
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    conversationId: uuid('conversation_id').references(
      () => agentConversations.id,
    ),
    mastraRunId: text('mastra_run_id'),
    toolCallId: text('tool_call_id'),
    suspendPath: text('suspend_path'),
    actionType: actionType('action_type').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: approvalStatus('status').notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: varchar('decision_note', { length: 1000 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    result: jsonb('result').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('agent_approval_run_idx').on(t.runId),
    index('agent_approval_conversation_idx').on(t.conversationId),
    index('agent_approval_pending_idx')
      .on(t.status)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Append-only audit of side-effects the agent performed (no baseColumns). */
export const agentActionLog = pgTable(
  'agent_action_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    conversationId: uuid('conversation_id'),
    actorUserId: uuid('actor_user_id'),
    actionType: actionType('action_type').notNull(),
    toolId: text('tool_id').notNull(),
    status: actionStatus('status').notNull(),
    summary: varchar('summary', { length: 1000 }).notNull(),
    detail: jsonb('detail')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    approvalId: uuid('approval_id').references(() => agentApprovals.id),
  },
  (t) => [
    index('agent_action_log_run_idx').on(t.runId),
    index('agent_action_log_created_idx').on(t.createdAt),
    index('agent_action_log_type_idx').on(t.actionType),
  ],
);

/** Scheduled-run definitions (admin-managed). */
export const agentSchedules = pgTable(
  'agent_schedule',
  {
    ...baseColumns,
    name: varchar('name', { length: 200 }).notNull(),
    description: varchar('description', { length: 1000 }),
    cron: varchar('cron', { length: 120 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    enabled: boolean('enabled').notNull().default(true),
    targetUserId: uuid('target_user_id').references(() => users.id),
    agentId: text('agent_id').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    params: jsonb('params')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    deliveryChannel: deliveryChannel('delivery_channel')
      .notNull()
      .default('conversation'),
    deliveryTarget: varchar('delivery_target', { length: 500 }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: varchar('last_run_status', { length: 40 }),
    lastRunId: uuid('last_run_id'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('agent_schedule_name_idx')
      .on(t.name)
      .where(sql`${t.isDeleted} = false`),
    index('agent_schedule_enabled_idx')
      .on(t.enabled)
      .where(sql`${t.isDeleted} = false`),
  ],
);

export type AgentConversationRow = typeof agentConversations.$inferSelect;
export type NewAgentConversationRow = typeof agentConversations.$inferInsert;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type NewAgentRunRow = typeof agentRuns.$inferInsert;
export type AgentApprovalRow = typeof agentApprovals.$inferSelect;
export type NewAgentApprovalRow = typeof agentApprovals.$inferInsert;
export type AgentActionLogRow = typeof agentActionLog.$inferSelect;
export type NewAgentActionLogRow = typeof agentActionLog.$inferInsert;
export type AgentScheduleRow = typeof agentSchedules.$inferSelect;
export type NewAgentScheduleRow = typeof agentSchedules.$inferInsert;
