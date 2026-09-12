import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { assertEveryRouteDeclaresPolicy } from '../src/common/route-policy.audit';
import { EntityAccessRegistry } from '../src/features/shared/entity-access.registry';
import { assertPermissionCatalogIsComplete } from '../src/features/authorization/permission-catalog.assertion';
import { RetentionPurgeRegistry } from '../src/infrastructure/retention/retention.registry';

/**
 * Boots the WHOLE application and runs the checks `main.ts` runs before it
 * listens.
 *
 * The other e2e suites build module subsets, so none of them exercises the real
 * composition root, the global guards, or the boot-time assertions — a route
 * missing `@Roles`, a `@RequirePermission` naming an unseeded key, or a module
 * that fails to resolve would all pass those suites and fail in production.
 *
 * Requires Postgres (migrated + seeded), Redis, MinIO and Meilisearch.
 */
describe('Application boot (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('assembles the full module graph', () => {
    expect(app).toBeDefined();
  });

  it('has a policy on every route', () => {
    // The same audit main.ts runs; it throws if any handler declares neither
    // @Roles nor @Public.
    expect(() => assertEveryRouteDeclaresPolicy(app)).not.toThrow();
  });

  it('resolves every permission a route requires', async () => {
    // A typo in @RequirePermission would otherwise deny every caller silently
    // and surface as an unexplained 403 in production.
    await expect(
      assertPermissionCatalogIsComplete(app),
    ).resolves.toBeUndefined();
  });

  it('registers an entity access resolver for each scoped entity type', () => {
    // An unregistered type is denied to non-admins, so a missing registration
    // is a silent loss of function rather than a leak — but still a bug.
    const registry = app.get(EntityAccessRegistry);
    expect(registry.registeredTypes()).toEqual(
      expect.arrayContaining([
        'contact',
        'contact_company',
        'knowledge',
        'project',
        'task',
      ]),
    );
  });

  it('registers a retention purge for each governed log table', () => {
    // An enabled policy with no handler means a table growing unattended.
    const registry = app.get(RetentionPurgeRegistry);
    expect(registry.registeredTypes()).toEqual(
      expect.arrayContaining([
        'activity_log',
        'notifications',
        'notification_delivery_attempts',
        'system_event_log',
      ]),
    );
  });
});
