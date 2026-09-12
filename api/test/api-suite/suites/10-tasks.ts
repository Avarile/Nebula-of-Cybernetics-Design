import { isoDate } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Tasks — the part of the product the mock user actually owns.
 *
 * Its baseline role carries `project.task.read/create/update` and
 * `project.time.log` but not `project.task.delete`, so the mock user does all
 * the real work here and the admin only cleans up. The time entries logged at
 * the end are the input the invoices suite later bills.
 */
export async function run(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  if (!ctx.ids.projectId) {
    client.skip('tasks', '/tasks', 'POST', 'no project was created');
    return;
  }
  const projectId = ctx.ids.projectId;

  // ------------------------------------------------------------------- create

  const task = await client.call({
    name: 'user creates a task in the project it belongs to',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: {
      projectId,
      title: `Wire up the ingest worker ${stamp}`,
      description: 'Primary task fixture created by the live API suite.',
      status: 'todo',
      priority: 'high',
      assigneeUserId: ctx.ids.mockUserId,
      milestoneId: ctx.ids.milestoneId,
      estimateMinutes: 480,
      startDate: isoDate(0),
      dueDate: isoDate(14),
      tagIds: ctx.ids.tagTaskId ? [ctx.ids.tagTaskId] : undefined,
    },
    expect: 201,
    assert: (b) => {
      if (b?.projectId !== projectId) return 'projectId did not persist';
      if (b?.assigneeUserId !== ctx.ids.mockUserId)
        return 'assignee did not persist';
      return undefined;
    },
  });
  if (task.ok) ctx.ids.taskId = task.body.id;

  const blocker = await client.call({
    name: 'user creates a second task to act as a predecessor',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: {
      projectId,
      title: `Provision the ingest queue ${stamp}`,
      status: 'in_progress',
      priority: 'urgent',
    },
    expect: 201,
  });
  if (blocker.ok) ctx.ids.blockerTaskId = blocker.body.id;

  await client.call({
    name: 'a task must name a project',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: { title: 'Orphan task' },
    expect: 400,
  });

  await client.call({
    name: 'a task cannot be filed against a project that does not exist',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: {
      projectId: '00000000-0000-4000-8000-000000000000',
      title: 'Orphan task',
    },
    expect: [400, 403, 404, 409, 422],
  });

  await client.call({
    name: 'a tag from another scope cannot be attached to a task',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: {
      projectId,
      title: 'Wrong-scope tag',
      tagIds: ctx.ids.tagProjectId ? [ctx.ids.tagProjectId] : [],
    },
    expect: [400, 422],
  });

  await client.call({
    name: 'an unknown task status is rejected',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: { projectId, title: 'Bad status', status: 'pondering' },
    expect: 400,
  });

  // -------------------------------------------------------------------- read

  await client.call({
    name: 'user lists the project’s tasks',
    method: 'GET',
    path: '/tasks',
    actor: 'user',
    query: { projectId, page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      if (rows.length < 2)
        return `expected both fixture tasks, got ${rows.length}`;
      const foreign = rows.find((t) => t.projectId !== projectId);
      return foreign ? 'project filter leaked a task' : undefined;
    },
  });

  await client.call({
    name: 'tasks can be filtered by assignee',
    method: 'GET',
    path: '/tasks',
    actor: 'user',
    query: { assigneeUserId: ctx.ids.mockUserId, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const foreign = rows.find((t) => t.assigneeUserId !== ctx.ids.mockUserId);
      return foreign ? 'assignee filter leaked a task' : undefined;
    },
  });

  await client.call({
    name: 'tasks can be filtered by status',
    method: 'GET',
    path: '/tasks',
    actor: 'user',
    query: { projectId, status: 'in_progress', limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const wrong = rows.find((t) => t.status !== 'in_progress');
      return wrong ? `status filter leaked a ${wrong.status} task` : undefined;
    },
  });

  await client.call({
    name: 'tasks can be searched by title',
    method: 'GET',
    path: '/tasks',
    actor: 'user',
    query: { search: 'ingest worker', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((t) => t.id === ctx.ids.taskId)
        ? undefined
        : 'search did not find the task just created';
    },
  });

  await client.call({
    name: 'an agent can read tasks',
    method: 'GET',
    path: '/tasks',
    actor: 'agent',
    query: { limit: 5 },
    expect: 200,
  });

  if (!ctx.ids.taskId) return;
  const id = ctx.ids.taskId;

  await client.call({
    name: 'user reads the task',
    method: 'GET',
    path: '/tasks/{id}',
    params: { id },
    actor: 'user',
    expect: 200,
  });

  await client.call({
    name: 'an unknown task id is a 404',
    method: 'GET',
    path: '/tasks/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'user',
    expect: 404,
  });

  // ------------------------------------------------------------------ update

  await client.call({
    name: 'user updates the task',
    method: 'PATCH',
    path: '/tasks/{id}',
    params: { id },
    actor: 'user',
    body: { estimateMinutes: 600, priority: 'urgent' },
    expect: 200,
    assert: (b) =>
      b?.estimateMinutes === 600
        ? undefined
        : `estimate was ${b?.estimateMinutes}`,
  });

  await client.call({
    name: 'blocking a task records the reason',
    method: 'PATCH',
    path: '/tasks/{id}',
    params: { id },
    actor: 'user',
    body: { status: 'blocked', blockedReason: 'Waiting on the ingest queue.' },
    expect: 200,
    assert: (b) =>
      b?.status === 'blocked' ? undefined : `status was ${b?.status}`,
  });

  await client.call({
    name: 'user moves the task along the board',
    method: 'POST',
    path: '/tasks/{id}/move',
    params: { id },
    actor: 'user',
    body: { status: 'in_progress' },
    expect: [200, 201, 204],
  });

  await client.call({
    name: 'an unknown move target is rejected',
    method: 'POST',
    path: '/tasks/{id}/move',
    params: { id },
    actor: 'user',
    body: { status: 'shipped' },
    expect: 400,
  });

  // ------------------------------------------------------------ dependencies

  if (ctx.ids.blockerTaskId) {
    const dependency = await client.call({
      name: 'user declares a finish-to-start dependency',
      method: 'POST',
      path: '/tasks/{id}/dependencies',
      params: { id },
      actor: 'user',
      body: {
        predecessorTaskId: ctx.ids.blockerTaskId,
        type: 'finish_to_start',
        lagDays: 1,
      },
      expect: 201,
    });
    if (dependency.ok) ctx.ids.dependencyId = dependency.body.id;

    await client.call({
      name: 'a task cannot depend on itself',
      method: 'POST',
      path: '/tasks/{id}/dependencies',
      params: { id },
      actor: 'user',
      body: { predecessorTaskId: id },
      expect: [400, 409, 422],
    });

    await client.call({
      name: 'the reverse dependency would be a cycle and is refused',
      method: 'POST',
      path: '/tasks/{id}/dependencies',
      params: { id: ctx.ids.blockerTaskId },
      actor: 'user',
      body: { predecessorTaskId: id },
      expect: [400, 409, 422],
    });

    await client.call({
      name: 'user lists the task’s dependencies',
      method: 'GET',
      path: '/tasks/{id}/dependencies',
      params: { id },
      actor: 'user',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        return rows.length > 0
          ? undefined
          : 'the dependency just created is not listed';
      },
    });

    if (ctx.ids.dependencyId) {
      await client.call({
        name: 'user removes the dependency',
        method: 'DELETE',
        path: '/tasks/{id}/dependencies/{dependencyId}',
        params: { id, dependencyId: ctx.ids.dependencyId },
        actor: 'user',
        expect: 204,
      });
    }
  }

  // ---------------------------------------------------------------- watchers

  await client.call({
    name: 'user starts watching the task',
    method: 'POST',
    path: '/tasks/{id}/watch',
    params: { id },
    actor: 'user',
    expect: 204,
  });

  await client.call({
    name: 'watching twice is idempotent',
    method: 'POST',
    path: '/tasks/{id}/watch',
    params: { id },
    actor: 'user',
    expect: [204, 409],
  });

  await client.call({
    name: 'the watcher list includes the mock user',
    method: 'GET',
    path: '/tasks/{id}/watchers',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((w) => (w.userId ?? w.id) === ctx.ids.mockUserId)
        ? undefined
        : 'the mock user is not listed as a watcher';
    },
  });

  await client.call({
    name: 'user stops watching the task',
    method: 'DELETE',
    path: '/tasks/{id}/watch',
    params: { id },
    actor: 'user',
    expect: 204,
  });

  // ------------------------------------------------------------ time tracking

  const billable = await client.call({
    name: 'user logs billable time against the task',
    method: 'POST',
    path: '/tasks/{id}/time',
    params: { id },
    actor: 'user',
    body: {
      minutes: 180,
      workDate: isoDate(-1),
      description: 'Implementation of the ingest worker.',
      isBillable: true,
      hourlyRate: '185.0000',
      currency: 'AUD',
    },
    expect: 201,
  });
  if (billable.ok) ctx.ids.timeEntryId = billable.body.id;

  await client.call({
    name: 'user logs a second billable entry',
    method: 'POST',
    path: '/tasks/{id}/time',
    params: { id },
    actor: 'user',
    body: {
      minutes: 120,
      workDate: isoDate(0),
      description: 'Ingest worker tests.',
      isBillable: true,
      hourlyRate: '185.0000',
      currency: 'AUD',
    },
    expect: 201,
  });

  await client.call({
    name: 'user logs non-billable time',
    method: 'POST',
    path: '/tasks/{id}/time',
    params: { id },
    actor: 'user',
    body: {
      minutes: 45,
      workDate: isoDate(0),
      description: 'Internal design discussion.',
      isBillable: false,
    },
    expect: 201,
  });

  await client.call({
    name: 'a time entry needs a work date',
    method: 'POST',
    path: '/tasks/{id}/time',
    params: { id },
    actor: 'user',
    body: { minutes: 30 },
    expect: 400,
  });

  await client.call({
    name: 'a malformed hourly rate is rejected',
    method: 'POST',
    path: '/tasks/{id}/time',
    params: { id },
    actor: 'user',
    body: { minutes: 30, workDate: isoDate(0), hourlyRate: 'lots' },
    expect: 400,
  });

  await client.call({
    name: 'user reads its own time entries',
    method: 'GET',
    path: '/tasks/time',
    actor: 'user',
    query: { projectId, from: isoDate(-7), to: isoDate(1), page: 1, limit: 50 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? (Array.isArray(b) ? b : []);
      return rows.length >= 3
        ? undefined
        : `expected 3 entries, got ${rows.length}`;
    },
  });

  await client.call({
    name: 'a malformed date range is rejected',
    method: 'GET',
    path: '/tasks/time',
    actor: 'user',
    query: { from: 'yesterday' },
    expect: 400,
  });

  await client.call({
    name: 'unbilled time now shows the billable entries',
    method: 'GET',
    path: '/projects/{id}/unbilled-time',
    params: { id: projectId },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      if (rows.length < 2)
        return `expected at least 2 unbilled entries, got ${rows.length}`;
      const nonBillable = rows.find((e) => e.isBillable === false);
      return nonBillable
        ? 'non-billable time is showing as unbilled'
        : undefined;
    },
  });

  // A disposable entry so the delete path is covered without consuming the time
  // the invoices suite is about to bill.
  const disposableEntry = await client.call({
    name: 'user logs a disposable time entry',
    method: 'POST',
    path: '/tasks/{id}/time',
    params: { id },
    actor: 'user',
    body: { minutes: 15, workDate: isoDate(0), description: 'Mis-logged.' },
    expect: 201,
  });

  if (disposableEntry.ok) {
    await client.call({
      name: 'user deletes the mis-logged entry',
      method: 'DELETE',
      path: '/tasks/time/{entryId}',
      params: { entryId: disposableEntry.body.id },
      actor: 'user',
      expect: 204,
    });
  }

  // ----------------------------------------------------------------- delete

  const spare = await client.call({
    name: 'user creates a disposable task',
    method: 'POST',
    path: '/tasks',
    actor: 'user',
    body: { projectId, title: `Disposable task ${stamp}` },
    expect: 201,
  });

  if (spare.ok) {
    await client.call({
      name: 'a standard user cannot delete a task it created',
      method: 'DELETE',
      path: '/tasks/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin deletes the disposable task',
      method: 'DELETE',
      path: '/tasks/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the deleted task is gone',
      method: 'GET',
      path: '/tasks/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 404,
    });
  }
}
