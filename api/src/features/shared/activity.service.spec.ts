import {
  GUEST_PRINCIPAL,
  SYSTEM_PRINCIPAL,
  type Principal,
} from '../../common/principal';
import { RetentionPurgeRegistry } from '../../infrastructure/retention/retention.registry';
import { ActivityService } from './activity.service';

const user: Principal = { kind: 'user', userId: 'user-1', role: 'user' };
const service: Principal = {
  kind: 'service',
  credentialId: 'cred-1',
  role: 'agent',
};

describe('ActivityService', () => {
  let repo: any;
  let registry: RetentionPurgeRegistry;
  let activity: ActivityService;

  beforeEach(() => {
    repo = {
      append: jest.fn(async (row: any) => ({ id: 'a1', ...row })),
      list: jest.fn(async () => ({ rows: [], total: 0 })),
      purgeOlderThan: jest.fn(async () => 3),
    };
    registry = new RetentionPurgeRegistry();
    activity = new ActivityService(repo, registry);
  });

  describe('actor derivation', () => {
    it('records a human against actor_user_id', async () => {
      await activity.record({
        principal: user,
        entityType: 'task',
        action: 'task.created',
      });
      expect(repo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          actorKind: 'user',
          actorUserId: 'user-1',
          actorCredentialId: null,
        }),
        undefined,
      );
    });

    it('never writes a credential id into the users foreign key', async () => {
      // The whole reason this service exists: `service_credentials.id` is not a
      // `users.id`, and writing it to actor_user_id violates the FK.
      await activity.record({
        principal: service,
        entityType: 'task',
        action: 'task.created',
      });
      const [row] = repo.append.mock.calls[0];
      expect(row.actorUserId).toBeNull();
      expect(row.actorCredentialId).toBe('cred-1');
      expect(row.actorKind).toBe('service');
    });

    it.each([
      ['system', SYSTEM_PRINCIPAL],
      ['anonymous', GUEST_PRINCIPAL],
    ])('records %s with no actor id', async (_label, principal) => {
      await activity.record({
        principal: principal as Principal,
        entityType: 'system',
        action: 'sweep.ran',
      });
      const [row] = repo.append.mock.calls[0];
      expect(row.actorKind).toBe('system');
      expect(row.actorUserId).toBeNull();
      expect(row.actorCredentialId).toBeNull();
    });
  });

  it('passes the caller transaction through, so history commits with the change', async () => {
    const tx = { marker: true } as never;
    await activity.record(
      { principal: user, entityType: 'task', action: 'task.updated' },
      tx,
    );
    expect(repo.append).toHaveBeenCalledWith(expect.any(Object), tx);
  });

  it('propagates errors from record()', async () => {
    repo.append.mockRejectedValueOnce(new Error('db down'));
    await expect(
      activity.record({
        principal: user,
        entityType: 'task',
        action: 'task.created',
      }),
    ).rejects.toThrow('db down');
  });

  it('swallows errors from recordSafe(), which is its whole purpose', async () => {
    repo.append.mockRejectedValueOnce(new Error('db down'));
    await expect(
      activity.recordSafe({
        principal: user,
        entityType: 'task',
        action: 'task.created',
      }),
    ).resolves.toBeUndefined();
  });

  it('declares its own retention purge at bootstrap', async () => {
    // The sweep must never have to import this module to delete its rows.
    activity.onApplicationBootstrap();
    const purge = registry.get('activity_log');
    expect(purge).toBeDefined();
    await expect(purge!(new Date(), 10)).resolves.toBe(3);
    expect(repo.purgeOlderThan).toHaveBeenCalledWith(expect.any(Date), 10);
  });

  it('defaults the optional columns rather than writing undefined', async () => {
    await activity.record({
      principal: user,
      entityType: 'project',
      action: 'project.created',
    });
    const [row] = repo.append.mock.calls[0];
    expect(row).toMatchObject({
      entityId: null,
      summary: null,
      changes: {},
      projectId: null,
    });
  });
});
