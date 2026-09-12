import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  sessions,
  users,
  type NewSessionRow,
  type SessionRow,
} from '../../infrastructure/database/schema/identity.schema';

/** Access to the `sessions` (refresh-token) table. */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(row: NewSessionRow): Promise<SessionRow> {
    const rows = await this.db.insert(sessions).values(row).returning();
    return rows[0];
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * A session that is still usable: exists, not revoked, not expired, and owned
   * by a user who has not been soft-deleted.
   *
   * Read on every authenticated request (behind a cache) to decide whether the
   * access token minted from this session is still good.
   *
   * The join is deliberate. Deleting a user revokes their sessions, so the
   * `is_deleted` check should be redundant — but a token must not outlive its
   * account merely because some future code path forgets to revoke, and folding
   * it in here costs one join rather than a second round trip. (The FK's
   * `onDelete: 'cascade'` never fires: users are soft-deleted, not removed.)
   */
  async findLiveById(id: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select({ session: sessions })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.id, id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0]?.session ?? null;
  }

  // The revoke methods return the ids they touched so the caller can drop the
  // matching cache entries. `revokeFamily` and `revokeAllForUser` affect an
  // unknown set of rows, and without RETURNING there is no way to name them —
  // the revoked sessions would stay cached as live until their TTL lapsed.

  async revokeById(id: string): Promise<string[]> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    return rows.map((r) => r.id);
  }

  /**
   * Revoke a session ONLY if it is currently live, reporting whether this call
   * is the one that did it.
   *
   * Refresh rotation was read-then-write: both halves of a concurrent pair read
   * `revokedAt IS NULL` and both minted a token pair, splitting the family into
   * two live lineages and defeating the reuse detection that is supposed to
   * catch a stolen token. Making the revoke itself the compare-and-set means
   * exactly one caller can win.
   */
  async claimForRotation(id: string): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async revokeFamily(familyId: string): Promise<string[]> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.map((r) => r.id);
  }

  async revokeAllForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.map((r) => r.id);
  }

  /**
   * Hard-delete sessions that are terminal (revoked or expired) and older than
   * `cutoff`. Returns how many rows went.
   *
   * `sessions` gains a row per login per device and never lost one. These rows
   * are bookkeeping, not an audit trail — `system_audit_log` is that — so once
   * a session is both dead and past the retention window it carries no
   * information worth the storage.
   */
  async deleteTerminalBefore(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      // Expiry alone is the right predicate: a revoked session keeps its
      // original `expiresAt`, so this covers revoked and naturally-expired rows
      // alike, while the window preserves the recent history that
      // `GET /auth/sessions` and any incident review rely on.
      .where(lt(sessions.expiresAt, cutoff))
      .returning({ id: sessions.id });
    return rows.length;
  }

  async listActiveForUser(userId: string): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
  }
}
