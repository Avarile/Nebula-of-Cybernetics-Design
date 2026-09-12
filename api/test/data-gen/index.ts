import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ApiClient } from '../api-suite/harness/client';
import { createContext } from '../api-suite/harness/context';
import {
  bootstrapPrincipals,
  fatal,
  requireServer,
} from '../api-suite/harness/bootstrap';
import { emptyPools, GenReport, type GenContext } from './context';
import { plannedRequests, VOLUME } from './volume';

/**
 * API-driven test data generator.
 *
 * Every record is created by an HTTP call against a running server — there is
 * no database access in this directory at all. That is the point: data written
 * straight into Postgres proves nothing about whether the API can produce it,
 * and quietly bypasses the validation, ownership and permission rules that are
 * the interesting part of this system.
 *
 *   pnpm data:gen                 # against http://localhost:$PORT
 *   pnpm data:gen -- --verbose    # one line per HTTP call
 *   pnpm data:gen -- --only=crm,finance
 */

interface Phase {
  name: string;
  load: () => Promise<{ run(ctx: GenContext): Promise<void> }>;
}

const PHASES: Phase[] = [
  { name: 'foundations', load: () => import('./phases/foundations') },
  { name: 'crm', load: () => import('./phases/crm') },
  { name: 'knowledge', load: () => import('./phases/knowledge') },
  { name: 'projects', load: () => import('./phases/projects') },
  { name: 'finance', load: () => import('./phases/finance') },
  { name: 'system', load: () => import('./phases/system') },
  { name: 'search', load: () => import('./phases/search') },
  { name: 'collab', load: () => import('./phases/collab') },
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
    fatal('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set.');
  }

  const rate = {
    limit: Number(process.env.THROTTLE_LIMIT ?? 100),
    ttlMs: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
  };

  const planned = plannedRequests();
  const etaMinutes = Math.round(
    planned / (rate.limit / (rate.ttlMs / 1000)) / 60,
  );

  console.log('='.repeat(78));
  console.log('CYBERNETICS — API-DRIVEN DATA GENERATOR');
  console.log('='.repeat(78));
  console.log(`  target      ${baseUrl}`);
  console.log(
    `  throttle    ${rate.limit} requests / ${rate.ttlMs / 1000}s (self-paced)`,
  );
  console.log(
    `  planned     ~${planned} create calls  →  roughly ${etaMinutes} min`,
  );
  console.log(`  mode        ${verbose ? 'verbose' : 'summary'}`);
  console.log('');

  await requireServer(baseUrl);

  const client = new ApiClient(baseUrl, rate, verbose);
  const base = createContext(client, baseUrl);
  client.beginSuite('bootstrap');
  await bootstrapPrincipals(base, {
    adminEmail: adminEmail!,
    adminPassword: adminPassword!,
    mockPrefix: 'datagen.mock',
  });

  const ctx: GenContext = {
    client,
    stamp: base.stamp,
    adminUserId: base.facts.adminUserId ?? '',
    mockUserId: base.ids.mockUserId ?? '',
    pools: emptyPools(),
    report: new GenReport(),
  };

  const selected = only ? PHASES.filter((p) => only.includes(p.name)) : PHASES;
  if (only) {
    const unknown = only.filter((n) => !PHASES.some((p) => p.name === n));
    if (unknown.length) fatal(`Unknown phase(s): ${unknown.join(', ')}`);
  }

  const started = Date.now();
  for (const phase of selected) {
    if (verbose) console.log(`\n▸ ${phase.name}`);
    else process.stdout.write(`  ${phase.name} … `);
    try {
      const mod = await phase.load();
      await mod.run(ctx);
      if (!verbose) {
        console.log(`done (${ctx.report.totalCreated} records so far)`);
      }
    } catch (err) {
      if (!verbose) console.log('ERRORED');
      console.error(err instanceof Error ? err.stack : String(err));
      ctx.report.bad(
        `phase:${phase.name}`,
        0,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  ctx.report.print();
  console.log(`\nWall clock: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  console.log(`Mock non-admin user: ${client.principal('user').email}`);

  writeFileSync(
    resolve(__dirname, 'last-generation.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl,
        stamp: ctx.stamp,
        adminUserId: ctx.adminUserId,
        mockUserId: ctx.mockUserId,
        mockUserEmail: client.principal('user').email,
        volume: VOLUME,
        totalCreated: ctx.report.totalCreated,
        totalFailed: ctx.report.totalFailed,
        failures: ctx.report.failures,
      },
      null,
      2,
    ),
  );

  // A failed create is a finding, not a crash: the run still produced a corpus,
  // and the coverage report is what decides whether it is good enough.
  process.exit(0);
}

void main();
