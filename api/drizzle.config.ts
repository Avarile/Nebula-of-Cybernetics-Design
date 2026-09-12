import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration (consumed only by the CLI: `pnpm db:generate`,
 * `pnpm db:migrate`, `pnpm db:studio`). Reads `.env` directly since it runs
 * outside the Nest application; defaults match `.env.example`.
 */
loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema/index.ts',
  out: './src/infrastructure/database/migrations',
  dbCredentials: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? '5432'),
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'postgres',
    database: process.env.DATABASE_NAME ?? 'cybernetics',
    ssl: process.env.DATABASE_SSL === 'true',
  },
  verbose: true,
  strict: true,
});
