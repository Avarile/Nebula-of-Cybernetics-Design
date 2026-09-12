import { ExceptionService } from '../../infrastructure/exceptions';
import { SYSTEM_PRINCIPAL, type Principal } from '../../common/principal';
import { ProjectService } from './project.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };

function project(id: string, over: Partial<any> = {}) {
  return {
    id,
    name: `Project ${id}`,
    ownerUserId: null,
    visibility: 'internal',
    status: 'active',
    isDeleted: false,
    ...over,
  };
}

const page = { page: 1, limit: 100 } as never;

/**
 * Builds the service with only the collaborators a test cares about.
 *
 * Named rather than positional: the constructor takes ten dependencies now that
 * the delete cascade reaches four child repositories, and a row of bare
 * `{} as any` placeholders silently shifts when one is added.
 */
function build(over: Partial<Record<string, unknown>> = {}) {
  const deps = {
    db: {},
    repo: {},
    tasks: {},
    planning: {},
    links: {},
    projection: {},
    tags: {},
    activity: { recordSafe: jest.fn(async () => undefined) },
    cascade: {},
    ...over,
  };
  return new ProjectService(
    deps.db as never,
    deps.repo as never,
    deps.tasks as never,
    deps.planning as never,
    deps.links as never,
    deps.projection as never,
    deps.tags as never,
    deps.activity as never,
    deps.cascade as never,
    new ExceptionService(),
  );
}

describe('ProjectService.list', () => {
  let repo: any;
  let svc: ProjectService;
  const rows = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => project(id));

  beforeEach(() => {
    repo = {
      list: jest.fn(async () => ({ rows, total: rows.length })),
      membership: jest.fn(async () => null),
      membershipsForMany: jest.fn(async () => new Map()),
    };
    svc = build({ repo });
  });

  it('resolves a whole page of memberships in ONE query', async () => {
    // The regression: access was resolved per row, and `accessFor` issued one
    // `membership` select per project. A 100-row page therefore fired 100
    // concurrent queries at a pool of 20 shared with the queue workers.
    await svc.list(page, user);
    expect(repo.membershipsForMany).toHaveBeenCalledTimes(1);
    expect(repo.membershipsForMany).toHaveBeenCalledWith(
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      'u1',
    );
    expect(repo.membership).not.toHaveBeenCalled();
  });

  it('still grants the access a membership confers', async () => {
    repo.membershipsForMany.mockResolvedValueOnce(
      new Map([['p2', { projectId: 'p2', roleInProject: 'manager' }]]),
    );
    const out = await svc.list(page, user);
    const byId = Object.fromEntries(out.data.map((p: any) => [p.id, p.access]));
    expect(byId.p2).toBe('manager');
  });

  it('does not query memberships for an admin', async () => {
    // `accessFor` short-circuits admins, which is exactly why the N+1 never
    // showed up in admin-authenticated testing.
    const out = await svc.list(page, admin);
    expect(repo.membershipsForMany).not.toHaveBeenCalled();
    expect(out.data.every((p: any) => p.access === 'owner')).toBe(true);
  });

  it('does not query memberships for the system principal', async () => {
    const out = await svc.list(page, SYSTEM_PRINCIPAL);
    expect(repo.membershipsForMany).not.toHaveBeenCalled();
    expect(out.data.every((p: any) => p.access === 'owner')).toBe(true);
  });

  it('reports the repository total, not the page length', async () => {
    repo.list.mockResolvedValueOnce({ rows, total: 412 });
    const out = await svc.list(page, user);
    expect(out.total).toBe(412);
  });
});

/**
 * Ownership handover.
 *
 * The regression: `update()` moved `projects.owner_user_id` and nothing else,
 * while `resolveProjectAccess` grants `owner` from EITHER that column OR an
 * `owner` membership row. The outgoing owner kept their row, so handing a
 * project over transferred the title and revoked nothing — and the incoming
 * owner got no row at all, which hid them from the member list.
 */
describe('ProjectService.update — ownership handover', () => {
  const TX = { __tx: true } as any;
  let repo: any;
  let db: any;
  let svc: ProjectService;

  const owned = project('p1', { ownerUserId: 'old-owner', key: 'P1' });

  beforeEach(() => {
    db = { transaction: jest.fn(async (cb: any) => cb(TX)) };
    repo = {
      findLiveById: jest.fn(async () => owned),
      membership: jest.fn(async () => null),
      update: jest.fn(async () => ({ ...owned, ownerUserId: 'new-owner' })),
      demoteMember: jest.fn(async () => true),
      upsertMember: jest.fn(async () => ({})),
      setTags: jest.fn(async () => undefined),
      tagIdsFor: jest.fn(async () => []),
    };
    svc = build({
      db,
      repo,
      projection: { enqueueReprojection: jest.fn(async () => undefined) },
    });
  });

  it('demotes the outgoing owner and promotes the incoming one', async () => {
    await svc.update('p1', { ownerUserId: 'new-owner' } as never, admin);
    expect(repo.demoteMember).toHaveBeenCalledWith(
      'p1',
      'old-owner',
      'manager',
      TX,
    );
    expect(repo.upsertMember).toHaveBeenCalledWith(
      'p1',
      'new-owner',
      'owner',
      'a1',
      TX,
    );
  });

  it('does all three writes in ONE transaction', async () => {
    // A partial handover leaves the column and the membership row disagreeing,
    // and the access resolver honours both — so both would be owner.
    await svc.update('p1', { ownerUserId: 'new-owner' } as never, admin);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('p1', expect.anything(), TX);
  });

  it('demotes without promoting when ownership is cleared', async () => {
    repo.update.mockResolvedValueOnce({ ...owned, ownerUserId: null });
    await svc.update('p1', { ownerUserId: null } as never, admin);
    expect(repo.demoteMember).toHaveBeenCalled();
    expect(repo.upsertMember).not.toHaveBeenCalled();
  });

  it('does not open a transaction for an ordinary edit', async () => {
    await svc.update('p1', { name: 'renamed' } as never, admin);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('p1', expect.anything());
  });

  it('does not open a transaction when the owner is unchanged', async () => {
    await svc.update('p1', { ownerUserId: 'old-owner' } as never, admin);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

/**
 * Project delete cascades to the child tables.
 *
 * The regression: `remove()` soft-deleted only the project row. Its tasks
 * stayed live — unreadable, since every task route authorizes through the
 * parent, but still returned by the unfiltered task list and unreachable by
 * `DELETE /tasks/:id` for the same reason. Only direct SQL could retire them.
 */
describe('ProjectService.remove — cascade', () => {
  const TX = { __tx: true } as any;
  let db: any;
  let repo: any;
  let tasks: any;
  let planning: any;
  let links: any;
  let cascade: any;
  let projection: any;
  let svc: ProjectService;

  beforeEach(() => {
    db = { transaction: jest.fn(async (cb: any) => cb(TX)) };
    repo = {
      findLiveById: jest.fn(async () => project('p1', { ownerUserId: 'a1' })),
      membership: jest.fn(async () => null),
      softDelete: jest.fn(async () => undefined),
      softDeleteMembersForProject: jest.fn(async () => 2),
    };
    tasks = { softDeleteForProject: jest.fn(async () => ['t1', 't2']) };
    planning = {
      softDeleteMilestonesForProject: jest.fn(async () => 1),
      softDeleteGoalsForProject: jest.fn(async () => 1),
    };
    links = {
      softDeleteLinksForProject: jest.fn(async () => ({
        knowledge: 1,
        contacts: 0,
      })),
      softDeleteTimeEntriesForProject: jest.fn(async () => 3),
    };
    cascade = { purgeFor: jest.fn(async () => ({})) };
    projection = { enqueueDeprojection: jest.fn(async () => undefined) };
    svc = build({ db, repo, tasks, planning, links, cascade, projection });
  });

  it('retires every child table, not just the project row', async () => {
    await svc.remove('p1', admin);
    expect(tasks.softDeleteForProject).toHaveBeenCalledWith('p1', TX);
    expect(planning.softDeleteMilestonesForProject).toHaveBeenCalledWith(
      'p1',
      TX,
    );
    expect(planning.softDeleteGoalsForProject).toHaveBeenCalledWith('p1', TX);
    expect(links.softDeleteLinksForProject).toHaveBeenCalledWith('p1', TX);
    expect(links.softDeleteTimeEntriesForProject).toHaveBeenCalledWith(
      'p1',
      TX,
    );
    expect(repo.softDeleteMembersForProject).toHaveBeenCalledWith('p1', TX);
    expect(repo.softDelete).toHaveBeenCalledWith('p1', TX);
  });

  it('does all of it in ONE transaction', async () => {
    // A partial cascade is the failure mode this replaces: a deleted project
    // whose tasks are still live is unreachable through every API route.
    await svc.remove('p1', admin);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('joins the polymorphic comment/attachment purge to the same transaction', async () => {
    await svc.remove('p1', admin);
    expect(cascade.purgeFor).toHaveBeenCalledWith('project', 'p1', TX);
  });

  it('hands the retired task ids to the index job after the commit', async () => {
    await svc.remove('p1', admin);
    expect(projection.enqueueDeprojection).toHaveBeenCalledWith('p1', [
      't1',
      't2',
    ]);
  });
});
