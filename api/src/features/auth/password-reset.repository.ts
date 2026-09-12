import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  passwordResetCodes,
  type NewPasswordResetCodeRow,
  type PasswordResetCodeRow,
} from '../../infrastructure/database/schema/password-reset.schema';

/** Access to the `password_reset_codes` table. */
@Injectable()
export class PasswordResetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async insert(row: NewPasswordResetCodeRow): Promise<PasswordResetCodeRow> {
    const rows = await this.db
      .insert(passwordResetCodes)
      .values(row)
      .returning();
    return rows[0];
  }

  /** The user's most recent live (un-consumed) code, if any. */
  async findLiveByUser(userId: string): Promise<PasswordResetCodeRow | null> {
    const rows = await this.db
      .select()
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.userId, userId),
          isNull(passwordResetCodes.consumedAt),
        ),
      )
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Burn every live code for a user (called before issuing a new one). */
  async consumeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(passwordResetCodes.userId, userId),
          isNull(passwordResetCodes.consumedAt),
        ),
      );
  }

  /** Atomically bump the attempt counter; returns the new value. */
  async incrementAttempts(id: string): Promise<number> {
    const rows = await this.db
      .update(passwordResetCodes)
      .set({ attemptCount: sql`${passwordResetCodes.attemptCount} + 1` })
      .where(eq(passwordResetCodes.id, id))
      .returning();
    return rows[0]?.attemptCount ?? 0;
  }

  async consume(id: string): Promise<void> {
    await this.db
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetCodes.id, id));
  }

  /**
   * Drop codes that can no longer be used. Returns how many rows went.
   *
   * This method existed and was unit-tested but had no production caller, so
   * every reset code ever issued stayed in the table. `AuthCleanupProcessor`
   * now runs it.
   */
  async deleteExpired(now = new Date()): Promise<number> {
    const rows = await this.db
      .delete(passwordResetCodes)
      .where(lt(passwordResetCodes.expiresAt, now))
      .returning({ id: passwordResetCodes.id });
    return rows.length;
  }
}
