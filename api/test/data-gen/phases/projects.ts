import { create, tagsFor, type GenContext } from '../context';
import * as f from '../fake';
import { scaled, VOLUME } from '../volume';

/**
 * Projects and everything hanging off them.
 *
 * The non-admin half of the corpus lives here: the `user` role may create and
 * update tasks and log time, but not open a project, so the mock account is
 * made a member of most projects and then writes into them. That is also the
 * realistic shape — people work inside projects someone else opened.
 */
export async function run(ctx: GenContext): Promise<void> {
  const { client, stamp, pools, mockUserId } = ctx;
  client.beginSuite('projects');

  const STATUSES = [
    'draft',
    'active',
    'active',
    'on_hold',
    'completed',
  ] as const;
  const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
  const projectTags = tagsFor(pools, 'project');

  for (let i = 0; i < scaled(VOLUME.projects); i += 1) {
    const id = await create(ctx, 'projects', {
      name: `project ${i}`,
      method: 'POST',
      path: '/projects',
      actor: 'admin',
      body: {
        key: f.projectKey(i, stamp),
        name: `${f.companyName(i)} ${f.topic(i)} programme`,
        description: f.paragraph(i, 5),
        status: f.pick(STATUSES, i),
        priority: f.pick(PRIORITIES, i),
        visibility: i % 3 === 0 ? 'internal' : 'private',
        startDate: f.isoDate(-(30 + i * 3)),
        dueDate: f.isoDate(60 + i * 5),
        budgetAmount: f.money(25_000 + i * 3_500, 2),
        currency: pools.currency,
        color: `#${(0x2244aa + i * 7919).toString(16).slice(0, 6)}`,
        ...(projectTags.length ? { tagIds: [f.pick(projectTags, i * 3)] } : {}),
      },
      expect: 201,
    });
    if (id) {
      pools.projectIds.push(id);
      pools.tasksByProject.set(id, []);
    }
  }

  if (pools.projectIds.length === 0) return;

  // The mock account first, so it can write tasks into most projects; the
  // generated accounts after, to give membership lists real depth.
  const ROLES = ['contributor', 'manager', 'viewer', 'owner'] as const;
  for (const projectId of pools.projectIds) {
    await create(ctx, 'project_members', {
      name: 'mock user joins the project',
      method: 'POST',
      path: '/projects/{id}/members',
      params: { id: projectId },
      actor: 'admin',
      body: { userId: mockUserId, roleInProject: 'contributor' },
      expect: [201, 200, 204, 409],
    });
  }
  for (
    let i = 0;
    i < scaled(VOLUME.projectMembers) && pools.extraUserIds.length;
    i += 1
  ) {
    await create(ctx, 'project_members', {
      name: `member ${i}`,
      method: 'POST',
      path: '/projects/{id}/members',
      params: { id: f.pick(pools.projectIds, i) },
      actor: 'admin',
      body: {
        userId: f.pick(pools.extraUserIds, i),
        roleInProject: f.pick(ROLES, i),
      },
      expect: [201, 200, 204, 409],
    });
  }

  const M_STATUSES = ['pending', 'in_progress', 'reached', 'missed'] as const;
  for (let i = 0; i < scaled(VOLUME.milestones); i += 1) {
    const id = await create(ctx, 'milestones', {
      name: `milestone ${i}`,
      method: 'POST',
      path: '/projects/{id}/milestones',
      params: { id: f.pick(pools.projectIds, i) },
      actor: 'admin',
      body: {
        name: `${f.pick(['Alpha', 'Beta', 'GA', 'Hardening', 'Handover'], i)} ${i}`,
        description: f.paragraph(i, 2),
        status: f.pick(M_STATUSES, i),
        dueDate: f.isoDateTime((i % 120) - 30),
        sortOrder: i % 10,
      },
      expect: 201,
    });
    if (id) pools.milestoneIds.push(id);
  }

  // Objectives first; key results attach to them, which the DTO enforces.
  const objectives: string[] = [];
  for (let i = 0; i < scaled(VOLUME.goals); i += 1) {
    const asKeyResult = i % 3 === 2 && objectives.length > 0;
    const id = await create(ctx, 'goals', {
      name: `goal ${i}`,
      method: 'POST',
      path: '/projects/{id}/goals',
      params: { id: f.pick(pools.projectIds, i) },
      actor: 'admin',
      body: asKeyResult
        ? {
            kind: 'key_result',
            parentGoalId: f.pick(objectives, i),
            title: `Reduce ${f.topic(i)} turnaround (${i})`,
            metricName: 'turnaround_hours',
            targetValue: f.money(24 + (i % 20), 2),
            currentValue: f.money(40 + (i % 30), 2),
            unit: 'hours',
            direction: 'decrease',
            status: f.pick(['active', 'at_risk', 'achieved'], i),
            startDate: f.isoDateTime(-(20 + i)),
            dueDate: f.isoDateTime(60 + i),
          }
        : {
            kind: 'objective',
            title: `Make ${f.topic(i)} predictable (${i})`,
            description: f.paragraph(i, 3),
            status: f.pick(['draft', 'active', 'at_risk', 'achieved'], i),
            startDate: f.isoDateTime(-(30 + i)),
            dueDate: f.isoDateTime(90 + i),
          },
      expect: 201,
    });
    if (id && !asKeyResult) objectives.push(id);
  }

  await tasks(ctx);
  await links(ctx);
}

async function tasks(ctx: GenContext): Promise<void> {
  const { pools, mockUserId } = ctx;
  const STATUSES = [
    'backlog',
    'todo',
    'in_progress',
    'blocked',
    'in_review',
    'done',
    'cancelled',
  ] as const;
  const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
  const taskTags = tagsFor(pools, 'task');
  const assignees = [ctx.adminUserId, mockUserId, ...pools.extraUserIds].filter(
    Boolean,
  );

  const total = scaled(VOLUME.tasks.admin) + scaled(VOLUME.tasks.user);
  for (let i = 0; i < total; i += 1) {
    const actor = i < scaled(VOLUME.tasks.admin) ? 'admin' : 'user';
    const projectId = f.pick(pools.projectIds, i);
    const id = await create(ctx, 'tasks', {
      name: `task ${i}`,
      method: 'POST',
      path: '/tasks',
      actor,
      body: {
        projectId,
        title: `${f.taskTitle(i)} (${i})`,
        description: f.paragraph(i, 4),
        status: f.pick(STATUSES, i),
        priority: f.pick(PRIORITIES, i),
        estimateMinutes: 30 * ((i % 16) + 1),
        startDate: f.isoDateTime(-(i % 40)),
        dueDate: f.isoDateTime((i % 60) + 1),
        ...(assignees.length ? { assigneeUserId: f.pick(assignees, i) } : {}),
        ...(pools.milestoneIds.length && i % 3 === 0
          ? { milestoneId: f.pick(pools.milestoneIds, i) }
          : {}),
        ...(taskTags.length ? { tagIds: [f.pick(taskTags, i * 7)] } : {}),
      },
      expect: 201,
    });
    if (id) {
      pools.taskIds.push(id);
      pools.owner.set(id, actor);
      pools.tasksByProject.get(projectId)?.push(id);
    }
  }

  if (pools.taskIds.length === 0) return;

  // Dependencies must stay inside one project, and must not close a loop —
  // walking each project's list forwards guarantees both.
  const TYPES = [
    'finish_to_start',
    'start_to_start',
    'finish_to_finish',
    'start_to_finish',
  ] as const;
  let made = 0;
  for (const [, ids] of pools.tasksByProject) {
    for (
      let i = 1;
      i < ids.length && made < scaled(VOLUME.taskDependencies);
      i += 3
    ) {
      await create(ctx, 'task_dependencies', {
        name: `dependency ${made}`,
        method: 'POST',
        path: '/tasks/{id}/dependencies',
        params: { id: ids[i] },
        actor: 'admin',
        body: {
          predecessorTaskId: ids[i - 1],
          type: f.pick(TYPES, made),
          lagDays: made % 5,
        },
        expect: [201, 200, 400, 409],
      });
      made += 1;
    }
  }

  for (let i = 0; i < scaled(VOLUME.taskWatchers); i += 1) {
    await create(ctx, 'task_watchers', {
      name: `watcher ${i}`,
      method: 'POST',
      path: '/tasks/{id}/watch',
      params: { id: f.pick(pools.taskIds, i * 3) },
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {},
      expect: [201, 200, 204, 409],
    });
  }

  for (let i = 0; i < scaled(VOLUME.timeEntries); i += 1) {
    const id = await create(ctx, 'time_entries', {
      name: `time entry ${i}`,
      method: 'POST',
      path: '/tasks/{id}/time',
      params: { id: f.pick(pools.taskIds, i * 5) },
      actor: i % 2 === 0 ? 'admin' : 'user',
      body: {
        minutes: 15 * ((i % 24) + 1),
        workDate: f.isoDate(-(i % 60)),
        startedAt: f.isoDateTime(-(i % 60)),
        description: `Worked on ${f.topic(i)}.`,
        // Two thirds billable, so the invoice phase has time to bill and the
        // unbilled-time report has rows left after it.
        isBillable: i % 3 !== 0,
        hourlyRate: f.money(150 + (i % 5) * 25, 2),
        currency: pools.currency,
      },
      expect: 201,
    });
    if (id) pools.timeEntryIds.push(id);
  }
}

async function links(ctx: GenContext): Promise<void> {
  const { pools } = ctx;
  if (pools.contactIds.length) {
    const RELATIONSHIPS = [
      'client',
      'stakeholder',
      'vendor',
      'partner',
      'sponsor',
      'other',
    ] as const;
    for (let i = 0; i < scaled(VOLUME.projectContactLinks); i += 1) {
      await create(ctx, 'project_contact_links', {
        name: `project contact link ${i}`,
        method: 'POST',
        path: '/projects/{id}/contacts',
        params: { id: f.pick(pools.projectIds, i) },
        actor: 'admin',
        body: {
          contactId: f.pick(pools.contactIds, i * 11),
          relationship: f.pick(RELATIONSHIPS, i),
          isPrimary: i % 8 === 0,
          note: `Engaged for ${f.topic(i)}.`,
        },
        expect: [201, 200, 409],
      });
    }
  }

  if (pools.knowledgeIds.length) {
    const RELATIONS = [
      'reference',
      'requirement',
      'deliverable',
      'background',
    ] as const;
    for (let i = 0; i < scaled(VOLUME.projectKnowledgeLinks); i += 1) {
      await create(ctx, 'project_knowledge_links', {
        name: `project knowledge link ${i}`,
        method: 'POST',
        path: '/projects/{id}/knowledge',
        params: { id: f.pick(pools.projectIds, i * 3) },
        actor: 'admin',
        body: {
          knowledgeId: f.pick(pools.knowledgeIds, i * 5),
          relation: f.pick(RELATIONS, i),
          note: `Referenced by the ${f.topic(i)} workstream.`,
        },
        expect: [201, 200, 409],
      });
    }
  }
}
