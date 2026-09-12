import { ExceptionService } from '../../infrastructure/exceptions';
import { RetentionPurgeRegistry } from '../../infrastructure/retention/retention.registry';
import { RetentionService } from './retention.service';
import { RETENTION_BATCH_SIZE } from './system.constants';

function policy(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    entityType: 'activity_log',
    retentionDays: 120,
    action: 'purge',
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    lastDeletedCount: null,
    description: null,
    ...overrides,
  };
}

describe('RetentionService', () => {
  let repo: any;
  let registry: RetentionPurgeRegistry;
  let service: RetentionService;

  beforeEach(() => {
    repo = {
      listAll: jest.fn(async () => [policy()]),
      listEnabled: jest.fn(async () => [policy()]),
      recordRun: jest.fn(async () => undefined),
      setEnabled: jest.fn(async () => policy()),
      setRetentionDays: jest.fn(async () => policy()),
    };
    registry = new RetentionPurgeRegistry();
    service = new RetentionService(repo, registry, new ExceptionService());
  });

  it('skips — and flags — an enabled policy with no registered purge', async () => {
    // Reporting this as success would let a table grow unattended for months
    // while the policy row claimed to be running.
    const [result] = await service.runAll();
    expect(result).toMatchObject({ status: 'skipped', deleted: 0 });
    expect(repo.recordRun).toHaveBeenCalledWith('p1', 'skipped:no-handler', 0);
  });

  it('purges in batches and stops when a batch is short', async () => {
    const purge = jest
      .fn()
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockResolvedValueOnce(10);
    registry.register('activity_log', purge);

    const [result] = await service.runAll();
    expect(purge).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'ok',
      deleted: RETENTION_BATCH_SIZE + 10,
    });
  });

  it('passes a cutoff derived from the policy window', async () => {
    const purge = jest.fn(async () => 0);
    registry.register('activity_log', purge);
    const before = Date.now() - 120 * 24 * 60 * 60 * 1000;

    await service.runAll();
    const call = purge.mock.calls[0] as unknown as [Date, number];
    expect(call[1]).toBe(RETENTION_BATCH_SIZE);
    expect(Math.abs(call[0].getTime() - before)).toBeLessThan(5_000);
  });

  it('reports partial when the batch ceiling is hit, so the next tick continues', async () => {
    registry.register('activity_log', async () => RETENTION_BATCH_SIZE);
    const [result] = await service.runAll();
    expect(result.status).toBe('partial');
  });

  it('records a failure without losing the count already deleted', async () => {
    const purge = jest
      .fn()
      .mockResolvedValueOnce(RETENTION_BATCH_SIZE)
      .mockRejectedValueOnce(new Error('deadlock'));
    registry.register('activity_log', purge);

    const [result] = await service.runAll();
    expect(result).toMatchObject({
      status: 'failed',
      deleted: RETENTION_BATCH_SIZE,
    });
    expect(repo.recordRun).toHaveBeenCalledWith(
      'p1',
      'failed',
      RETENTION_BATCH_SIZE,
    );
  });

  it('ignores disabled policies entirely', async () => {
    repo.listEnabled.mockResolvedValueOnce([]);
    await expect(service.runAll()).resolves.toEqual([]);
  });

  it('surfaces whether a policy has a handler behind it', async () => {
    const [before] = await service.list();
    expect(before.hasPurgeHandler).toBe(false);
    registry.register('activity_log', async () => 0);
    const [after] = await service.list();
    expect(after.hasPurgeHandler).toBe(true);
  });
});
