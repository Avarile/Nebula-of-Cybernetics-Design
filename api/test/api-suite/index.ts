import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { ApiClient } from './harness/client';
import { createContext, type Ctx } from './harness/context';
import { Report } from './harness/report';
import { bootstrapPrincipals, fatal, requireServer } from './harness/bootstrap';

/**
 * Live API suite.
 *
 * Runs against an already-running server rather than booting the Nest
 * application in-process. That is the point: `pnpm test:e2e` proves the module
 * graph wires up, this proves the deployed process — with its real guards,
 * global pipes, throttler, database, Redis, MinIO and Meilisearch — answers
 * correctly for both a default admin and a freshly provisioned account.
 *
 *   pnpm test:api                  # against http://localhost:$PORT
 *   pnpm test:api -- --verbose     # one line per HTTP call
 *   pnpm test:api -- --only=finance,projects
 *   API_BASE_URL=https://... pnpm test:api
 */

interface SuiteModule {
  run(ctx: Ctx): Promise<void>;
}

const SUITES: Array<{ name: string; load: () => Promise<SuiteModule> }> = [
  { name: 'health', load: () => import('./suites/00-health') },
  { name: 'auth', load: () => import('./suites/01-auth') },
  { name: 'users', load: () => import('./suites/02-users') },
  { name: 'authorization', load: () => import('./suites/03-authorization') },
  { name: 'system', load: () => import('./suites/04-system') },
  { name: 'tags', load: () => import('./suites/05-tags') },
  { name: 'files', load: () => import('./suites/06-files') },
  { name: 'contacts', load: () => import('./suites/07-contacts') },
  { name: 'knowledge', load: () => import('./suites/08-knowledge') },
  { name: 'projects', load: () => import('./suites/09-projects') },
  { name: 'tasks', load: () => import('./suites/10-tasks') },
  { name: 'finance', load: () => import('./suites/11-finance') },
  { name: 'invoices', load: () => import('./suites/12-invoices') },
  { name: 'collab', load: () => import('./suites/13-collab') },
  { name: 'notifications', load: () => import('./suites/14-notifications') },
  { name: 'search', load: () => import('./suites/15-search') },
  { name: 'mailbox', load: () => import('./suites/16-mailbox') },
  { name: 'agent', load: () => import('./suites/17-agent') },
  { name: 'teardown', load: () => import('./suites/18-teardown') },
];

async function main(): Promise<void> {
  loadEnv({ path: resolve(__dirname, '../../.env'), quiet: true } as never);

  const argv = process.argv.slice(2);
  const verbose = argv.includes('--verbose') || argv.includes('-v');
  const only = argv
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const baseUrl = (
    process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  ).replace(/\/$/, '');

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    fatal(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set — the suite signs in as the default admin.',
    );
  }

  const rate = {
    limit: Number(process.env.THROTTLE_LIMIT ?? 100),
    ttlMs: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
  };

  banner(baseUrl, adminEmail!, rate, verbose);

  await requireServer(baseUrl);
  const operations = await Report.loadOperations(baseUrl);

  const client = new ApiClient(baseUrl, rate, verbose);
  const ctx = createContext(client, baseUrl);

  client.beginSuite('bootstrap');
  await bootstrapPrincipals(ctx, {
    adminEmail: adminEmail!,
    adminPassword: adminPassword!,
    mockPrefix: 'apisuite.mock',
  });

  const selected = only ? SUITES.filter((s) => only.includes(s.name)) : SUITES;
  if (only) {
    const unknown = only.filter((n) => !SUITES.some((s) => s.name === n));
    if (unknown.length) fatal(`Unknown suite(s): ${unknown.join(', ')}`);
  }

  const started = Date.now();
  for (const suite of selected) {
    client.beginSuite(suite.name);
    if (verbose) console.log(`\n▸ ${suite.name}`);
    else process.stdout.write(`  ${suite.name} … `);
    try {
      const mod = await suite.load();
      await mod.run(ctx);
      if (!verbose) console.log('done');
    } catch (err) {
      if (!verbose) console.log('ERRORED');
      client.assert(
        `suite "${suite.name}" threw`,
        'SUITE',
        `/${suite.name}`,
        err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
      );
    }
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  const report = new Report(client.results, operations);
  report.print();
  console.log(`\nWall clock: ${elapsed}s`);
  report.writeJson(resolve(__dirname, 'last-run.json'));

  process.exit(report.failures.length > 0 ? 1 : 0);
}

function banner(
  baseUrl: string,
  adminEmail: string,
  rate: { limit: number; ttlMs: number },
  verbose: boolean,
): void {
  console.log('='.repeat(78));
  console.log('CYBERNETICS — LIVE API SUITE');
  console.log('='.repeat(78));
  console.log(`  target      ${baseUrl}`);
  console.log(
    `  throttle    ${rate.limit} requests / ${rate.ttlMs / 1000}s (self-paced)`,
  );
  console.log(`  mode        ${verbose ? 'verbose' : 'summary'}`);
}

void main();
