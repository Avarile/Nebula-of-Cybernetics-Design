import type { DrizzleDB } from '../drizzle.constants';

/**
 * A seeder populates the database with initial/reference data.
 * Implementations are collected in `seeders/index.ts` and executed in order
 * by the seed runner (`pnpm seed`).
 */
export interface Seeder {
  /** Human-readable name for logging. */
  readonly name: string;
  run(db: DrizzleDB): Promise<void>;
}
