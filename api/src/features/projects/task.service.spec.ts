import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { TaskService } from './task.service';

/**
 * Builds the service with only the collaborators a test cares about.
 *
 * Named rather than positional: ten dependencies is enough that a row of bare
 * `{} as never` placeholders silently shifts when one is inserted.
 */
function build(over: Record<string, unknown> = {}) {
  const deps: Record<string, unknown> = {
    db: { transaction: jest.fn(async (cb: any) => cb({ __tx: true })) },
    repo: {},
    projects: { require: jest.fn(async () => undefined) },
    projectRepo: {},
    planning: {},
    board: {},
    projection: {},
    tags: {},
    activity: { recordSafe: jest.fn(async () => undefined) },
    cascade: {},
    ...over,
  };
  return new TaskService(
    deps.db as never,
    deps.repo as never,
    deps.projects as never,
    deps.projectRepo as never,
    deps.planning as never,
    deps.board as never,
    deps.projection as never,
    deps.tags as never,
    deps.activity as never,
    deps.cascade as never,
    new ExceptionService(),
  );
}

/**
 * The dependency graph guard.
 *
 * `addDependency(id, { predecessorTaskId })` creates the edge
 * `predecessor -> id`, and `predecessorsOf(t)` returns the tasks that must
 * finish before `t`. So the edge closes a loop exactly when the PREDECESSOR
 * already depends on `id`, and the reachability walk has to start there.
 *
 * The guard previously walked from `id` instead, which asks whether the edge is
 * redundant. That answers "no" for every genuine cycle, so `A -> B` followed by
 * `B -> A` was accepted and the graph stopped being acyclic — with nothing to
 * stop a scheduler walking it forever.
 */
describe('TaskService dependency cycles', () => {
  /** `edges[successor] = predecessors` — the shape `predecessorsOf` returns. */
  function serviceWith(edges: Record<string, string[]>) {
    const repo = {
      findLiveById: jest.fn(async (id: string) => ({
        id,
        projectId: 'p1',
        status: 'todo',
      })),
      predecessorsOf: jest.fn(async (id: string) => edges[id] ?? []),
      addDependency: jest.fn(async () => ({ id: 'dep1' })),
    };
    return { service: build({ repo }), repo };
  }

  const principal = { kind: 'user', userId: 'u1', role: 'admin' } as never;
  const dep = (predecessorTaskId: string) => ({ predecessorTaskId }) as never;

  it('accepts an edge that does not close a loop', async () => {
    const { service, repo } = serviceWith({});
    await expect(
      service.addDependency('B', dep('A'), principal),
    ).resolves.toEqual({ id: 'dep1' });
    expect(repo.addDependency).toHaveBeenCalledWith(
      'A',
      'B',
      undefined,
      undefined,
    );
  });

  it('refuses a task depending on itself', async () => {
    const { service } = serviceWith({});
    await expect(
      service.addDependency('A', dep('A'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  // The regression: A -> B exists, so adding B -> A closes a two-node loop.
  it('refuses the reverse of an existing edge', async () => {
    const { service, repo } = serviceWith({ B: ['A'] });
    await expect(
      service.addDependency('A', dep('B'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(repo.addDependency).not.toHaveBeenCalled();
  });

  // The case the guard's own comment claims to cover.
  it('refuses an edge closing a longer loop', async () => {
    // A -> B -> C already exists; C -> A would close it.
    const { service, repo } = serviceWith({ B: ['A'], C: ['B'] });
    await expect(
      service.addDependency('A', dep('C'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(repo.addDependency).not.toHaveBeenCalled();
  });

  // A diamond is not a cycle: both branches converge forwards.
  it('accepts a diamond', async () => {
    // A -> B, A -> C already exist; adding B -> D and C -> D is legitimate.
    const { service, repo } = serviceWith({ B: ['A'], C: ['A'], D: ['C'] });
    await expect(
      service.addDependency('D', dep('B'), principal),
    ).resolves.toEqual({ id: 'dep1' });
    expect(repo.addDependency).toHaveBeenCalled();
  });

  it('refuses a dependency that crosses projects', async () => {
    const { service, repo } = serviceWith({});
    repo.findLiveById.mockImplementation(async (id: string) => ({
      id,
      projectId: id === 'X' ? 'p2' : 'p1',
      status: 'todo',
    }));
    await expect(
      service.addDependency('A', dep('X'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('terminates on a graph that is already cyclic', async () => {
    // Should never happen, but the walk must not spin if it does.
    const { service } = serviceWith({ A: ['B'], B: ['A'] });
    await expect(
      service.addDependency('C', dep('A'), principal),
    ).resolves.toEqual({ id: 'dep1' });
  });
});

/**
 * Dependency removal must stay inside the task it was authorized against.
 *
 * The regression: the route authorized `taskId` and then deleted `dependencyId`
 * with nothing tying the two together, so a contributor on one project could
 * erase a scheduling edge in any other project whose edge id they had seen —
 * and `GET /tasks/:id/dependencies` hands those ids to every viewer.
 */
describe('TaskService.removeDependency scoping', () => {
  function serviceWith(removed: boolean) {
    const repo = {
      findLiveById: jest.fn(async (id: string) => ({
        id,
        projectId: 'p1',
        status: 'todo',
      })),
      removeDependency: jest.fn(async () => removed),
    };
    return { service: build({ repo }), repo };
  }

  const principal = { kind: 'user', userId: 'u1', role: 'admin' } as never;

  it('passes the authorized task id down as the scope', async () => {
    const { service, repo } = serviceWith(true);
    await service.removeDependency('task-a', 'dep-1', principal);
    expect(repo.removeDependency).toHaveBeenCalledWith('dep-1', 'task-a');
  });

  it('404s when the edge does not belong to the task', async () => {
    // The scoped predicate matches nothing, so the repository reports false —
    // an edge in another project is indistinguishable from one that is gone.
    const { service } = serviceWith(false);
    await expect(
      service.removeDependency('task-a', 'edge-in-another-project', principal),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

/**
 * `/move` and `PATCH /tasks/:id` must enforce the same invariants.
 *
 * The regression: `update()` checked the blocker reason, refused to complete a
 * task with open predecessors, and stamped `completedAt`. `move()` wrote the
 * same `status` column through a bare repository update and did none of it —
 * and dragging a card to the Done column (what `cyb tasks mv --status done`
 * does) is the ordinary way to finish work, so the unguarded path was the
 * common one.
 *
 * Each case is asserted through BOTH entry points on purpose: the value of the
 * fix is the parity, not either check on its own.
 */
describe('TaskService status transitions — update/move parity', () => {
  const principal = { kind: 'user', userId: 'u1', role: 'admin' } as never;

  function serviceWith(
    task: Record<string, unknown>,
    blockers: unknown[] = [],
  ) {
    const repo = {
      findLiveById: jest.fn(
        async (id: string): Promise<Record<string, unknown>> => ({
          ...task,
          id,
        }),
      ),
      unfinishedPredecessors: jest.fn(async () => blockers),
      ranksAround: jest.fn(async () => ['i', 'r']),
      update: jest.fn(async (_id: string, patch: Record<string, unknown>) => ({
        ...task,
        ...patch,
      })),
      setTags: jest.fn(async () => undefined),
      watch: jest.fn(async () => undefined),
    };
    const service = build({
      repo,
      board: {
        rankFor: jest.fn(async () => 'm'),
        rebalanceIfNeeded: jest.fn(async () => 0),
      },
      planning: { findMilestone: jest.fn(async () => null) },
      projection: { projectTask: jest.fn(async () => undefined) },
      projects: {
        require: jest.fn(async () => undefined),
        repoRefreshProgress: jest.fn(async () => undefined),
      },
    });
    return { service, repo };
  }

  const open = { id: 't1', projectId: 'p1', status: 'todo', sortRank: 'i' };

  describe('a predecessor that is still open blocks completion', () => {
    it('via update()', async () => {
      const { service } = serviceWith(open, [{ id: 'blocker' }]);
      await expect(
        service.update('t1', { status: 'done' } as never, principal),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it('via move() — this is the one that used to slip through', async () => {
      const { service } = serviceWith(open, [{ id: 'blocker' }]);
      await expect(
        service.move('t1', { status: 'done' } as never, principal),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });

  describe('blocking a task requires a stated reason', () => {
    it('via update()', async () => {
      const { service } = serviceWith(open);
      await expect(
        service.update('t1', { status: 'blocked' } as never, principal),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('via move()', async () => {
      const { service } = serviceWith(open);
      await expect(
        service.move('t1', { status: 'blocked' } as never, principal),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });
  });

  describe('completing stamps completedAt', () => {
    it('via update()', async () => {
      const { service, repo } = serviceWith(open);
      await service.update('t1', { status: 'done' } as never, principal);
      expect(repo.update.mock.calls[0][1].completedAt).toBeInstanceOf(Date);
    });

    it('via move()', async () => {
      const { service, repo } = serviceWith(open);
      await service.move('t1', { status: 'done' } as never, principal);
      expect(repo.update.mock.calls[0][1].completedAt).toBeInstanceOf(Date);
    });
  });

  it('reopening a done task clears completedAt', async () => {
    // Left set, the task reads as complete to anything querying
    // `completed_at IS NOT NULL`, and cycle-time reporting counts a
    // completion that was undone.
    const done = { ...open, status: 'done', completedAt: new Date() };
    const { service, repo } = serviceWith(done);
    await service.update('t1', { status: 'todo' } as never, principal);
    expect(repo.update.mock.calls[0][1].completedAt).toBeNull();
  });
});
