import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { assertEveryRouteDeclaresPolicy } from '../src/common/route-policy.audit';
import { AppModule } from '../src/app.module';

jest.setTimeout(60_000);

/**
 * Whole-application smoke test — the only suite that boots the real `AppModule`.
 *
 * Every other e2e suite assembles a module subset, so none of them would notice
 * a composition-root mistake. That gap is not hypothetical: `SystemModule` once
 * shipped exporting a provider that had moved into `SystemAuditModule`, and the
 * first thing to catch it was a developer running `nest start`. `pnpm
 * check:graph` now covers the wiring without infrastructure; this covers the
 * rest — that the app initialises against live dependencies and serves HTTP.
 *
 * Booting AppModule under Jest is why `test/jest-e2e.json` sets
 * `transformIgnorePatterns: []` and transforms `.mjs`: `@mastra/core` reaches a
 * chain of ESM-only packages (`@sindresorhus/slugify` -> `transliterate` ->
 * `tokenx` -> ...) that Node loads natively but Jest's CJS transform will not.
 * Transforming all of node_modules costs a little startup and removes the
 * "never import AppModule" caveat the other suites were written around.
 *
 * Requires Postgres, Redis, MinIO and MeiliSearch. Run with `pnpm test:e2e`.
 */
describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('passes the boot-time route policy audit', () => {
    // The same check `main.ts` runs before listen(). Asserting it here means a
    // route that declares neither @Public() nor @Roles(...) fails the suite
    // rather than the deployment.
    expect(() => assertEveryRouteDeclaresPolicy(app)).not.toThrow();
  });

  // Liveness cannot fail: it runs no indicators, so a 503 here would mean the
  // probe had acquired a dependency it should not have. It used to check heap
  // against a hardcoded 300 MB, which made an orchestrator restart the
  // container on a memory spike.
  it('always answers the public liveness probe with 200', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  // 503 is a legitimate answer from a probe reporting on things it does not
  // control — but either way it must carry the per-component report. Terminus
  // signals failure by throwing, and the global exception filter used to
  // rewrite that into the generic error envelope, discarding the detail on the
  // one path where it matters.
  it('serves the public readiness probe with a per-component report', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('details');
    // Redacted: status only, never the driver's error text.
    for (const component of Object.values(res.body.details ?? {})) {
      expect(Object.keys(component as object)).toEqual(['status']);
    }
  });

  it('requires admin for the detailed health report', async () => {
    // Deliberately not public. The detailed report names every dependency and
    // its failure reason, which is a free infrastructure map for an anonymous
    // caller — the probes above are what orchestrators actually need.
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(401);
  });
});
