import { Injectable, Optional } from '@nestjs/common';
import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import { isAdmin, userIdOrNull } from '../../../common/principal';
import type { ConversationKind, PrincipalRef } from '../mastra.types';
import {
  ConversationRepository,
  type ConversationListRow,
} from '../repositories/conversation.repository';
import { SystemAuditService } from '../../system/system-audit.service';
import { sanitizeTitle } from './conversation-title';

/** The conversation shape the client sees — no ownership or storage internals. */
export interface PublicConversation {
  id: string;
  title: string | null;
  kind: ConversationKind;
  status: string;
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `title` is an explicit override (backfilled, or renamed by a user later);
 * when unset we fall back to the title Mastra generated for the thread.
 */
function toPublicConversation(row: ConversationListRow): PublicConversation {
  return {
    id: row.id,
    title: sanitizeTitle(row.title) ?? sanitizeTitle(row.generatedTitle),
    kind: row.kind,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Resolves/creates the Mastra-thread-backed conversation for a principal and
 * enforces ownership: a conversation may be read/continued only by the user who
 * owns it, or by an admin. An unowned conversation (`ownerUserId IS NULL`,
 * which is what system/schedule triggers create) is admin-only.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly repo: ConversationRepository,
    private readonly errors: ExceptionService,
    // Optional so a module-subset e2e context that does not import
    // SystemAuditModule still boots; the access check itself never depends on it.
    @Optional() private readonly audit?: SystemAuditService,
  ) {}

  private resourceOf(p: PrincipalRef): string {
    return userIdOrNull(p) ?? 'system';
  }

  /**
   * Authorize a read/continue of an existing conversation.
   *
   * Fails closed on a NULL `ownerUserId`. The previous predicate —
   * `principal.id && conv.ownerUserId && conv.ownerUserId !== principal.id` —
   * short-circuited whenever the row had no owner, and system/scheduled runs
   * create exactly such rows. That let any authenticated caller read a system
   * conversation's transcript, continue it, and (because the approval path
   * gates on this same method) approve its pending `send-email` / `db-write`
   * tool call. A conversation with no owner is now system-owned: admin only.
   */
  private async assertCanAccess(
    principal: PrincipalRef,
    conv: { id: string; ownerUserId: string | null },
  ): Promise<void> {
    const userId = userIdOrNull(principal);
    if (isAdmin(principal)) {
      // Admins may read any conversation, but reading someone else's private
      // AI transcript should leave a trace. Only cross-owner reads are logged —
      // an admin in their own conversation is unremarkable.
      if (conv.ownerUserId !== userId) {
        await this.audit?.record({
          ctx: { actorId: userId },
          action: 'conversation.admin_read',
          entityType: 'conversation',
          entityId: conv.id,
          metadata: { ownerUserId: conv.ownerUserId },
        });
      }
      return;
    }
    if (!userId || conv.ownerUserId !== userId) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Not your conversation',
      });
    }
  }

  /**
   * Return the live conversation for `conversationId` (403 if the principal may
   * not access it), or create a new one owned by the principal.
   */
  async ensure(
    principal: PrincipalRef,
    conversationId?: string,
    kind: ConversationKind = 'chat',
  ) {
    if (conversationId) {
      const existing = await this.repo.findLiveById(conversationId);
      if (!existing) {
        throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
      }
      await this.assertCanAccess(principal, existing);
      return existing;
    }
    return this.repo.create({
      // `userIdOrNull`, not the raw subject id: `owner_user_id` references
      // `users.id`, so a service credential's id here is an FK violation.
      ownerUserId: userIdOrNull(principal),
      resourceId: this.resourceOf(principal),
      kind,
    } as never);
  }

  /**
   * Page of conversations owned by the principal; empty for anonymous ones.
   *
   * Returns the `{ data, total, page, limit }` envelope every paginated list in
   * this API uses (cf. `UsersService.list`) — the history rail reads `.data`.
   */
  async listForOwner(
    principal: PrincipalRef,
    page = 1,
    limit = 20,
  ): Promise<{
    data: PublicConversation[];
    total: number;
    page: number;
    limit: number;
  }> {
    const userId = userIdOrNull(principal);
    if (!userId) return { data: [], total: 0, page, limit };
    const { rows, total } = await this.repo.listByOwner(userId, page, limit);
    return { data: rows.map(toPublicConversation), total, page, limit };
  }

  /** Fetch a conversation by id, 404 if missing, 403 if the principal may not access it. */
  async getOwned(principal: PrincipalRef, id: string) {
    const conv = await this.repo.findLiveById(id);
    if (!conv) throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
    await this.assertCanAccess(principal, conv);
    return conv;
  }

  /** Bump activity metadata (last message time / count) on a conversation. */
  async touch(id: string): Promise<void> {
    await this.repo.touch(id);
  }
}
