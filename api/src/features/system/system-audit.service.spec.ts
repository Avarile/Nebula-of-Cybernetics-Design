import { SystemAuditService } from './system-audit.service';

describe('SystemAuditService', () => {
  let repo: any;
  let service: SystemAuditService;

  beforeEach(() => {
    repo = {
      insert: jest.fn(async () => undefined),
      list: jest.fn(async () => ({ rows: [], total: 0 })),
    };
    service = new SystemAuditService(repo);
  });

  it('records an audit row with the actor + context', async () => {
    await service.record({
      ctx: { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' },
      action: 'smtp.create',
      entityType: 'smtp',
      entityId: 'cfg-1',
      metadata: { fields: ['host', 'port'] },
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'smtp.create',
        entityType: 'smtp',
        entityId: 'cfg-1',
        ip: '1.2.3.4',
        userAgent: 'jest',
        metadata: { fields: ['host', 'port'] },
      }),
    );
  });

  it('never throws when the audit write fails', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({
        ctx: { actorId: null },
        action: 'setting.update',
        entityType: 'setting',
      }),
    ).resolves.toBeUndefined();
  });

  it('lists audit rows with pagination', async () => {
    repo.list.mockResolvedValueOnce({ rows: [{ id: 'a1' }], total: 1 });
    const res = await service.list({ page: 1, limit: 20 });
    expect(res).toEqual({ data: [{ id: 'a1' }], total: 1, page: 1, limit: 20 });
  });
});
