import { ServiceUnavailableException } from '@nestjs/common';
import { GIT_SHA, VERSION } from '../../version';
import { HealthController } from './health.controller';

const HEAP_THRESHOLD = 1_073_741_824;

/** A healthy report from every dependency, in Terminus' shape. */
const healthy = {
  status: 'ok',
  info: { database: { status: 'up' }, redis: { status: 'up' } },
  error: {},
  details: { database: { status: 'up' }, redis: { status: 'up' } },
};

/** Redis down, with the driver's message attached — as the indicators do. */
const unhealthy = {
  status: 'error',
  info: { database: { status: 'up' } },
  error: {
    redis: { status: 'down', message: 'ECONNREFUSED 10.0.0.5:6379' },
  },
  details: {
    database: { status: 'up' },
    redis: { status: 'down', message: 'ECONNREFUSED 10.0.0.5:6379' },
  },
};

function make(result: unknown, throws = false) {
  const check = jest.fn(async (indicators: unknown[]) => {
    if (throws) throw new ServiceUnavailableException(result);
    // Run them so the spy records which indicators were registered.
    await Promise.all((indicators as (() => unknown)[]).map((fn) => fn()));
    return result;
  });
  const indicator = (name: string) => ({
    isHealthy: jest.fn(async () => ({ [name]: { status: 'up' } })),
  });
  const memory = { checkHeap: jest.fn(async () => ({ memory_heap: {} })) };
  const res = { status: jest.fn() };
  const controller = new HealthController(
    { check } as never,
    indicator('database') as never,
    memory as never,
    indicator('redis') as never,
    indicator('minio') as never,
    indicator('meilisearch') as never,
    {
      getOrThrow: () => ({ healthHeapThresholdBytes: HEAP_THRESHOLD }),
    } as never,
  );
  return { controller, check, memory, res };
}

describe('HealthController', () => {
  describe('live', () => {
    // A liveness failure makes an orchestrator restart the container, so this
    // probe deliberately runs nothing that could fail. It used to check heap
    // against a hardcoded 300 MB, turning a memory spike into a restart loop.
    it('reports ok without consulting any indicator', () => {
      const { controller, check, memory } = make(healthy);
      expect(controller.live()).toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
      expect(check).not.toHaveBeenCalled();
      expect(memory.checkHeap).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('checks the dependencies but not the heap', async () => {
      const { controller, memory, res } = make(healthy);
      await controller.ready(res as never);
      // Shedding a process from the load balancer because it holds memory just
      // moves the same traffic onto its peers.
      expect(memory.checkHeap).not.toHaveBeenCalled();
    });

    it('leaves the status alone while everything is up', async () => {
      const { controller, res } = make(healthy);
      const out = await controller.ready(res as never);
      expect(res.status).not.toHaveBeenCalled();
      expect(out.status).toBe('ok');
    });

    it('answers 503 and still returns the per-component report', async () => {
      const { controller, res } = make(unhealthy, true);
      const out = await controller.ready(res as never);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(out.status).toBe('error');
      expect(out.details).toEqual({
        database: { status: 'up' },
        redis: { status: 'down' },
      });
    });

    // The whole point of the public/admin split: an anonymous caller learns
    // that Redis is down, not where Redis lives.
    it('redacts driver detail from every component', async () => {
      const { controller, res } = make(unhealthy, true);
      const out = await controller.ready(res as never);
      expect(JSON.stringify(out)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(out)).not.toContain('10.0.0.5');
    });

    // Same rule applied to build identity: a version number is where
    // CVE-matching starts, so it rides on the admin endpoint only.
    it('keeps the build identity off the public probe', async () => {
      const { controller, res } = make(healthy);
      const out = await controller.ready(res as never);
      expect(out.info).not.toHaveProperty('build');
      expect(out.details).not.toHaveProperty('build');
    });
  });

  describe('check (admin)', () => {
    it('includes the heap indicator at the configured threshold', async () => {
      const { controller, memory, res } = make(healthy);
      await controller.check(res as never);
      expect(memory.checkHeap).toHaveBeenCalledWith(
        'memory_heap',
        HEAP_THRESHOLD,
      );
    });

    it('answers 503 with the unredacted detail an operator needs', async () => {
      const { controller, res } = make(unhealthy, true);
      const out = await controller.check(res as never);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(JSON.stringify(out)).toContain('ECONNREFUSED');
    });

    it('reports which build is running', async () => {
      const { controller, res } = make(healthy);
      const out = await controller.check(res as never);
      const build = { status: 'up', version: VERSION, sha: GIT_SHA };
      expect(out.details.build).toEqual(build);
      expect(out.info?.build).toEqual(build);
      // Attaching it leaves the indicators' own report untouched.
      expect(out.details.database).toEqual({ status: 'up' });
      expect(out.status).toBe('ok');
    });

    // Which build is running matters most when something is broken, so it has
    // to survive the 503 path too.
    it('reports the build on a failing report as well', async () => {
      const { controller, res } = make(unhealthy, true);
      const out = await controller.check(res as never);
      expect(out.details.build).toMatchObject({ version: VERSION });
      expect(out.status).toBe('error');
    });

    // Anything that is not Terminus reporting "unhealthy" is a real fault and
    // belongs to the exception filter, not to a 503 health payload.
    it('rethrows a non-health error rather than reporting it as unhealthy', async () => {
      const { res } = make(healthy);
      const boom = new Error('indicator blew up');
      const controllerWithBoom = new HealthController(
        {
          check: jest.fn(() => {
            throw boom;
          }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {
          getOrThrow: () => ({ healthHeapThresholdBytes: HEAP_THRESHOLD }),
        } as never,
      );
      await expect(controllerWithBoom.check(res as never)).rejects.toThrow(
        boom,
      );
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
