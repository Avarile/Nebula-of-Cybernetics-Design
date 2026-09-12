import { MeiliHealthIndicator } from './meili.health';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

describe('MeiliHealthIndicator', () => {
  const up = jest.fn(() => ({ meili: { status: 'up' } }));
  const down = jest.fn((d) => ({ meili: { status: 'down', ...d } }));
  const svc = { check: jest.fn(() => ({ up, down })) } as any;

  const healthyClient = { isHealthy: jest.fn(async () => true) } as any;

  /** Status service reporting a given lag, or absent entirely. */
  function statusService(lagSeconds: number, degraded: boolean) {
    return {
      cachedStats: jest.fn(async () => ({
        pending: degraded ? 5 : 0,
        indexed: 100,
        failed: degraded ? 2 : 0,
        oldestUnsyncedAt: null,
        maxAttempts: 0,
      })),
      lagSeconds: jest.fn(() => lagSeconds),
      isDegraded: jest.fn(() => degraded),
    } as any;
  }

  beforeEach(() => jest.clearAllMocks());

  it('reports up when the client is healthy', async () => {
    await new MeiliHealthIndicator(svc, healthyClient).isHealthy('meili');
    expect(up).toHaveBeenCalled();
  });

  it('reports down when the client throws', async () => {
    const client = {
      isHealthy: jest.fn(async () => {
        throw new Error('x');
      }),
    } as any;
    await new MeiliHealthIndicator(svc, client).isHealthy('meili');
    expect(down).toHaveBeenCalled();
  });

  it('reports down when the client is reachable but unhealthy', async () => {
    const client = { isHealthy: jest.fn(async () => false) } as any;
    await new MeiliHealthIndicator(svc, client).isHealthy('meili');
    expect(down).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'meilisearch not healthy' }),
    );
  });

  // A live Meili serving a stale read model is an outage from the caller's
  // point of view; a liveness-only probe would stay green through it.
  it('reports down when the index pipeline has fallen behind', async () => {
    const status = statusService(900, true);
    await new MeiliHealthIndicator(svc, healthyClient, status).isHealthy(
      'meili',
    );
    expect(down).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'search index lagging by 900s',
        lagSeconds: 900,
        failed: 2,
      }),
    );
  });

  it('reports up with lag detail while the pipeline is keeping up', async () => {
    const status = statusService(3, false);
    await new MeiliHealthIndicator(svc, healthyClient, status).isHealthy(
      'meili',
    );
    expect(up).toHaveBeenCalledWith(
      expect.objectContaining({ lagSeconds: 3, pending: 0 }),
    );
  });

  it('falls back to the liveness check when no status service is wired', async () => {
    await new MeiliHealthIndicator(svc, healthyClient, undefined).isHealthy(
      'meili',
    );
    expect(up).toHaveBeenCalledWith();
  });

  it('reports down when the status query itself fails', async () => {
    const status = {
      cachedStats: jest.fn(async () => {
        throw new Error('db down');
      }),
      lagSeconds: jest.fn(),
      isDegraded: jest.fn(),
    } as any;
    await new MeiliHealthIndicator(svc, healthyClient, status).isHealthy(
      'meili',
    );
    expect(down).toHaveBeenCalledWith({ message: 'db down' });
  });
});
