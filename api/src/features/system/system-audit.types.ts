/** The kinds of records the system module audits. */
export type AuditEntityType =
  'smtp' | 'imap' | 'integration' | 'setting' | 'conversation';

/** Who/where a mutation came from — sourced from the request principal. */
export interface AuditContext {
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** A single audit event to record. `metadata` must never contain secrets. */
export interface RecordAuditInput {
  ctx: AuditContext;
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}
