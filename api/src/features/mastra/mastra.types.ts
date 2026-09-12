import { z } from 'zod';
import type { Principal } from '../../common/principal';
import type { SearchRecordService } from '../search-service/search-record.service';

export type ConversationKind = 'chat' | 'scheduled' | 'event';
export type ConversationStatus = 'active' | 'archived';
export type RunTrigger = 'user_message' | 'schedule' | 'event' | 'api';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type ActionType = 'send_email' | 'db_write' | 'external_api' | 'other';
export type ApprovalStatus =
  'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed';
export type ActionStatus = 'success' | 'failed';
export type DeliveryChannel = 'conversation' | 'email' | 'none';

/**
 * The acting principal, as this module sees it.
 *
 * Aliased to the app-wide `Principal` union rather than redeclared. It used to
 * be a structural `{ id: string | null; role?: string }`, which happily accepted
 * a `service_credentials.id` in `id` and then wrote it into
 * `agent_conversation.owner_user_id` — a column with a `users.id` foreign key.
 */
export type PrincipalRef = Principal;
export interface CuratedSearchResult {
  collection: string;
  totalHits: number;
  hits: Array<Record<string, unknown>>;
  facets?: Record<string, Record<string, number>>;
}
export interface CuratedMetric {
  metric: string;
  value: number;
  unit: string;
  period: string;
  breakdown: Array<{ key: string; value: number }>;
}
export interface PendingApproval {
  toolCallId: string;
  actionType: ActionType;
  title: string;
  payload: Record<string, unknown>;
}
export interface ToolRuntime {
  principal: PrincipalRef;
  runId: string | null;
  conversationId: string | null;
}

/** Deps captured by tool closures at buildMastra time (app-lifetime services). */
export interface ToolServices {
  searchRecords: Pick<SearchRecordService, 'search'>;
  sendEmail: (msg: {
    to: string;
    subject: string;
    text: string;
    cc?: string;
  }) => Promise<void>;
  recordAction: (entry: {
    runId: string | null;
    conversationId: string | null;
    actorUserId: string | null;
    actionType: ActionType;
    toolId: string;
    status: ActionStatus;
    summary: string;
    detail?: Record<string, unknown>;
  }) => Promise<void>;
}

/** Structured report shape produced by the analyze step / structuredOutput. */
export const AgentReportSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), detail: z.string() })),
  recommendedActions: z
    .array(z.object({ action: z.string(), rationale: z.string() }))
    .default([]),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;
