import { Injectable, Logger } from '@nestjs/common';
import type { SystemAuditRow } from '../../infrastructure/database/schema/system.schema';
import {
  SystemAuditRepository,
  type AuditListQuery,
} from './system-audit.repository';
import type { RecordAuditInput } from './system-audit.types';

@Injectable()
export class SystemAuditService {
  private readonly logger = new Logger(SystemAuditService.name);

  constructor(private readonly repo: SystemAuditRepository) {}

  /**
   * Record an audit event.
   *
   * Failures are logged rather than thrown, because losing the trail must not
   * fail a mutation that already succeeded — but the log line is `error` level
   * and names the action, so a silently vanishing audit trail is visible in
   * monitoring rather than invisible. Callers that need the stronger guarantee
   * (write-or-fail) should record inside their own transaction instead.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.repo.insert({
        actorId: input.ctx.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
        ip: input.ctx.ip ?? null,
        userAgent: input.ctx.userAgent ?? null,
      });
    } catch (err) {
      this.logger.error(
        `AUDIT WRITE LOST for ${input.action} on ${input.entityType}` +
          `${input.entityId ? ` (${input.entityId})` : ''} by ${input.ctx.actorId ?? 'unknown'}` +
          ` — the mutation succeeded but is unrecorded`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async list(q: AuditListQuery): Promise<{
    data: SystemAuditRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { rows, total } = await this.repo.list(q);
    return { data: rows, total, page: q.page, limit: q.limit };
  }
}
