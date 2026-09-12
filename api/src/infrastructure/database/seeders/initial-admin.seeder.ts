import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { validateEnv } from '../../../config/env.validation';
import type { DrizzleDB } from '../drizzle.constants';
import { users } from '../schema/identity.schema';
import type { Seeder } from './seeder.interface';

/**
 * Idempotently creates the initial admin from SEED_ADMIN_EMAIL /
 * SEED_ADMIN_PASSWORD. This is the only bootstrap path — public signup is
 * disabled. Skips (with a warning) if no password is configured, or if an admin
 * already exists.
 */
export class InitialAdminSeeder implements Seeder {
  readonly name = 'initial-admin';

  async run(db: DrizzleDB): Promise<void> {
    const env = validateEnv(process.env);
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const password = env.SEED_ADMIN_PASSWORD;

    if (!password) {
      console.warn('  ↳ SEED_ADMIN_PASSWORD not set — skipping admin seed.');
      return;
    }

    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isDeleted, false)))
      .limit(1);
    if (existing.length > 0) {
      console.log('  ↳ An admin already exists — skipping.');
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db.insert(users).values({ email, passwordHash, role: 'admin' });
    console.log(`  ↳ Created initial admin: ${email}`);
  }
}
