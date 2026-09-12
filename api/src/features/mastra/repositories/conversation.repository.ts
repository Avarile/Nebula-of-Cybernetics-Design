import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import {
  agentConversations,
  type AgentConversationRow,
} from '../../../infrastructure/database/schema/agent.schema';
import { mastraThreads } from './mastra-threads.table';

/** A conversation row plus the title Mastra generated for its backing thread. */
export type ConversationListRow = AgentConversationRow & {
  generatedTitle: string | null;
};

/** Repository for the `agent_conversation` table (thin metadata over a Mastra thread). */
@Injectable()
export class ConversationRepository extends BaseRepository<
  typeof agentConversations
> {
  private threadsExist = false;

  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, agentConversations);
  }

  /** A live (non-deleted) conversation by id. */
  async findLiveById(id: string): Promise<AgentConversationRow | null> {
    const rows = await this.db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.id, id),
          eq(agentConversations.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * A page of live conversations owned by a user, newest activity first, each
   * carrying the title Mastra generated for its backing thread.
   */
  /**
   * Whether Mastra's own thread table exists yet.
   *
   * `mastra.mastra_threads` is created by `@mastra/pg` on first use, not by any
   * Drizzle migration (deliberately — see `mastra-threads.table.ts`). On a
   * freshly migrated database, before any agent has run, joining it threw
   * `relation does not exist` and turned GET /agent/conversations into a 500.
   * Cached after the first positive answer: the table is never dropped.
   */
  private async threadsTableExists(): Promise<boolean> {
    if (this.threadsExist) return true;
    const result = await this.db.execute<{ present: boolean }>(
      sql`select to_regclass('mastra.mastra_threads') is not null as present`,
    );
    this.threadsExist = Boolean(result.rows[0]?.present);
    return this.threadsExist;
  }

  async listByOwner(
    ownerUserId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: ConversationListRow[]; total: number }> {
    const where = and(
      eq(agentConversations.ownerUserId, ownerUserId),
      eq(agentConversations.isDeleted, false),
    );
    // Without the generated title when Mastra has not created its table yet —
    // the conversation list is still perfectly useful, it just falls back to
    // the explicit title (or null).
    if (!(await this.threadsTableExists())) {
      const bare = await this.db
        .select(getTableColumns(agentConversations))
        .from(agentConversations)
        .where(where)
        .orderBy(
          desc(
            sql`coalesce(${agentConversations.lastMessageAt}, ${agentConversations.createdAt})`,
          ),
        )
        .limit(limit)
        .offset((page - 1) * limit);
      const bareTotals = await this.db
        .select({ value: count() })
        .from(agentConversations)
        .where(where);
      return {
        rows: bare.map((row) => ({ ...row, generatedTitle: null })),
        total: Number(bareTotals[0]?.value ?? 0),
      };
    }

    const rows = await this.db
      .select({
        ...getTableColumns(agentConversations),
        generatedTitle: mastraThreads.title,
      })
      .from(agentConversations)
      // Our id is `uuid`, Mastra's thread id is `text` — the cast is required.
      .leftJoin(
        mastraThreads,
        eq(sql`${agentConversations.id}::text`, mastraThreads.id),
      )
      .where(where)
      // `lastMessageAt` stays NULL until a turn succeeds, and Postgres sorts
      // NULLs FIRST on DESC — without the coalesce, a chat whose first turn
      // failed would pin itself to the top of the history rail forever.
      .orderBy(
        desc(
          sql`coalesce(${agentConversations.lastMessageAt}, ${agentConversations.createdAt})`,
        ),
      )
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(agentConversations)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** Bump `lastMessageAt` and increment `messageCount` for a conversation. */
  async touch(id: string): Promise<void> {
    await this.db
      .update(agentConversations)
      .set({
        lastMessageAt: new Date(),
        messageCount: sql`${agentConversations.messageCount} + 1`,
      })
      .where(eq(agentConversations.id, id));
  }
}
