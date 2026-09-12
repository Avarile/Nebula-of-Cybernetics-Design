import { isoDate } from '../harness/context';
import type { Ctx } from '../harness/context';

/**
 * Projects and their planning artefacts: membership, milestones, goals, and the
 * links out to knowledge and CRM.
 *
 * The baseline `user` role can read projects but not create or update them, so
 * the admin owns the project and the mock user joins it as a contributor. That
 * is the realistic arrangement, and it is what makes the tasks suite that
 * follows meaningful — the mock user works inside a project it does not own.
 */
export async function run(ctx: Ctx): Promise<void> {
  await lifecycle(ctx);
  await members(ctx);
  await milestones(ctx);
  await goals(ctx);
  await links(ctx);
}

async function lifecycle(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;

  await client.call({
    name: 'a standard user cannot create a project',
    method: 'POST',
    path: '/projects',
    actor: 'user',
    body: { key: `USRPROJ${stamp.slice(-4)}`, name: 'Should not exist' },
    expect: 403,
  });

  const project = await client.call({
    name: 'admin creates a project',
    method: 'POST',
    path: '/projects',
    actor: 'admin',
    body: {
      key: `APIS${stamp.slice(-6)}`,
      name: `API Suite Delivery ${stamp}`,
      description: 'Fixture project created by the live API suite.',
      status: 'active',
      priority: 'high',
      leadUserId: ctx.facts.adminUserId,
      visibility: 'internal',
      startDate: isoDate(-7),
      dueDate: isoDate(60),
      budgetAmount: '25000.00',
      currency: 'AUD',
      color: '#2563eb',
      tagIds: ctx.ids.tagProjectId ? [ctx.ids.tagProjectId] : undefined,
    },
    expect: 201,
    assert: (b) =>
      b?.status === 'active' ? undefined : `status was ${b?.status}`,
  });
  if (project.ok) ctx.ids.projectId = project.body.id;

  await client.call({
    name: 'a project key must be upper-case and alphanumeric',
    method: 'POST',
    path: '/projects',
    actor: 'admin',
    body: { key: 'lower case', name: 'Bad key' },
    expect: 400,
  });

  await client.call({
    name: 'a duplicate project key is refused',
    method: 'POST',
    path: '/projects',
    actor: 'admin',
    body: { key: `APIS${stamp.slice(-6)}`, name: 'Duplicate key' },
    expect: [409, 400, 422],
  });

  await client.call({
    name: 'a malformed budget amount is rejected',
    method: 'POST',
    path: '/projects',
    actor: 'admin',
    body: {
      key: `BADAMT${stamp.slice(-4)}`,
      name: 'Bad amount',
      budgetAmount: '12.3456789',
    },
    expect: 400,
  });

  await client.call({
    name: 'admin lists projects',
    method: 'GET',
    path: '/projects',
    actor: 'admin',
    query: { page: 1, limit: 20 },
    expect: 200,
    assert: (b) =>
      Array.isArray(b?.data) ? undefined : 'expected a paginated envelope',
  });

  await client.call({
    name: 'projects can be filtered by status',
    method: 'GET',
    path: '/projects',
    actor: 'admin',
    query: { status: 'active', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      const wrong = rows.find((p) => p.status !== 'active');
      return wrong
        ? `status filter leaked a ${wrong.status} project`
        : undefined;
    },
  });

  await client.call({
    name: 'projects can be searched by name',
    method: 'GET',
    path: '/projects',
    actor: 'admin',
    query: { search: 'API Suite Delivery', limit: 20 },
    expect: 200,
    assert: (b) => {
      const rows: any[] = b?.data ?? [];
      return rows.some((p) => p.id === ctx.ids.projectId)
        ? undefined
        : 'search did not find the project just created';
    },
  });

  if (!ctx.ids.projectId) return;

  await client.call({
    name: 'admin reads the project',
    method: 'GET',
    path: '/projects/{id}',
    params: { id: ctx.ids.projectId },
    actor: 'admin',
    expect: 200,
  });

  await client.call({
    name: 'admin updates the project',
    method: 'PATCH',
    path: '/projects/{id}',
    params: { id: ctx.ids.projectId },
    actor: 'admin',
    body: { priority: 'urgent', description: 'Revised by the live API suite.' },
    expect: 200,
    assert: (b) =>
      b?.priority === 'urgent' ? undefined : `priority was ${b?.priority}`,
  });

  await client.call({
    name: 'a standard user cannot update the project',
    method: 'PATCH',
    path: '/projects/{id}',
    params: { id: ctx.ids.projectId },
    actor: 'user',
    body: { priority: 'low' },
    expect: 403,
  });

  await client.call({
    name: 'an unknown project id is a 404',
    method: 'GET',
    path: '/projects/{id}',
    params: { id: '00000000-0000-4000-8000-000000000000' },
    actor: 'admin',
    expect: 404,
  });

  const spare = await client.call({
    name: 'admin creates a disposable project',
    method: 'POST',
    path: '/projects',
    actor: 'admin',
    body: {
      key: `DISP${stamp.slice(-6)}`,
      name: `Disposable Project ${stamp}`,
    },
    expect: 201,
  });

  if (spare.ok) {
    await client.call({
      name: 'a standard user cannot delete a project',
      method: 'DELETE',
      path: '/projects/{id}',
      params: { id: spare.body.id },
      actor: 'user',
      expect: 403,
    });

    await client.call({
      name: 'admin deletes the disposable project',
      method: 'DELETE',
      path: '/projects/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 204,
    });

    await client.call({
      name: 'the deleted project is gone',
      method: 'GET',
      path: '/projects/{id}',
      params: { id: spare.body.id },
      actor: 'admin',
      expect: 404,
    });
  }
}

async function members(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.projectId) {
    client.skip(
      'project members',
      '/projects/{id}/members',
      'POST',
      'no project was created',
    );
    return;
  }
  const id = ctx.ids.projectId;

  await client.call({
    name: 'admin adds the mock user as a contributor',
    method: 'POST',
    path: '/projects/{id}/members',
    params: { id },
    actor: 'admin',
    body: { userId: ctx.ids.mockUserId, roleInProject: 'contributor' },
    expect: 204,
  });

  if (ctx.ids.secondUserId) {
    await client.call({
      name: 'admin adds a second member as a viewer',
      method: 'POST',
      path: '/projects/{id}/members',
      params: { id },
      actor: 'admin',
      body: { userId: ctx.ids.secondUserId, roleInProject: 'viewer' },
      expect: 204,
    });
  }

  await client.call({
    name: 'an unknown project role is rejected',
    method: 'POST',
    path: '/projects/{id}/members',
    params: { id },
    actor: 'admin',
    body: { userId: ctx.ids.mockUserId, roleInProject: 'overlord' },
    expect: 400,
  });

  await client.call({
    name: 'the member list includes the mock user',
    method: 'GET',
    path: '/projects/{id}/members',
    params: { id },
    actor: 'admin',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.some((m) => m.userId === ctx.ids.mockUserId)
        ? undefined
        : 'the mock user is not listed as a member';
    },
  });

  await client.call({
    name: 'a member can now read the project',
    method: 'GET',
    path: '/projects/{id}',
    params: { id },
    actor: 'user',
    expect: 200,
  });

  await client.call({
    name: 'a standard user cannot manage membership',
    method: 'POST',
    path: '/projects/{id}/members',
    params: { id },
    actor: 'user',
    body: { userId: ctx.ids.mockUserId, roleInProject: 'owner' },
    expect: 403,
  });

  if (ctx.ids.secondUserId) {
    await client.call({
      name: 'admin removes the viewer',
      method: 'DELETE',
      path: '/projects/{id}/members/{userId}',
      params: { id, userId: ctx.ids.secondUserId },
      actor: 'admin',
      expect: 204,
    });
  }
}

async function milestones(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  if (!ctx.ids.projectId) {
    client.skip(
      'project milestones',
      '/projects/{id}/milestones',
      'POST',
      'no project',
    );
    return;
  }
  const id = ctx.ids.projectId;

  const milestone = await client.call({
    name: 'admin creates a milestone',
    method: 'POST',
    path: '/projects/{id}/milestones',
    params: { id },
    actor: 'admin',
    body: {
      name: `Beta cut ${stamp}`,
      description: 'Feature freeze for the API suite fixture project.',
      status: 'in_progress',
      dueDate: isoDate(30),
      ownerUserId: ctx.facts.adminUserId,
      sortOrder: 1,
    },
    expect: 201,
  });
  if (milestone.ok) ctx.ids.milestoneId = milestone.body.id;

  await client.call({
    name: 'an unknown milestone status is rejected',
    method: 'POST',
    path: '/projects/{id}/milestones',
    params: { id },
    actor: 'admin',
    body: { name: 'Bad status', status: 'imminent' },
    expect: 400,
  });

  await client.call({
    name: 'user reads the project’s milestones',
    method: 'GET',
    path: '/projects/{id}/milestones',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length > 0
        ? undefined
        : 'the milestone just created is not listed';
    },
  });

  if (ctx.ids.milestoneId) {
    await client.call({
      name: 'admin marks the milestone reached',
      method: 'PATCH',
      path: '/projects/milestones/{milestoneId}',
      params: { milestoneId: ctx.ids.milestoneId },
      actor: 'admin',
      body: { status: 'reached' },
      expect: 200,
      assert: (b) =>
        b?.status === 'reached' ? undefined : `status was ${b?.status}`,
    });

    await client.call({
      name: 'a standard user cannot edit a milestone',
      method: 'PATCH',
      path: '/projects/milestones/{milestoneId}',
      params: { milestoneId: ctx.ids.milestoneId },
      actor: 'user',
      body: { status: 'missed' },
      expect: 403,
    });
  }

  const spare = await client.call({
    name: 'admin creates a disposable milestone',
    method: 'POST',
    path: '/projects/{id}/milestones',
    params: { id },
    actor: 'admin',
    body: { name: `Disposable milestone ${stamp}` },
    expect: 201,
  });
  if (spare.ok) {
    await client.call({
      name: 'admin deletes the disposable milestone',
      method: 'DELETE',
      path: '/projects/milestones/{milestoneId}',
      params: { milestoneId: spare.body.id },
      actor: 'admin',
      expect: 204,
    });
  }
}

async function goals(ctx: Ctx): Promise<void> {
  const { client, stamp } = ctx;
  if (!ctx.ids.projectId) {
    client.skip('project goals', '/projects/{id}/goals', 'POST', 'no project');
    return;
  }
  const id = ctx.ids.projectId;

  const objective = await client.call({
    name: 'admin creates an objective',
    method: 'POST',
    path: '/projects/{id}/goals',
    params: { id },
    actor: 'admin',
    body: {
      kind: 'objective',
      title: `Ship the API suite ${stamp}`,
      description: 'Top-level objective for the fixture project.',
      status: 'active',
      startDate: isoDate(-7),
      dueDate: isoDate(60),
    },
    expect: 201,
  });
  if (objective.ok) ctx.ids.goalId = objective.body.id;

  if (ctx.ids.goalId) {
    await client.call({
      name: 'admin creates a key result under the objective',
      method: 'POST',
      path: '/projects/{id}/goals',
      params: { id },
      actor: 'admin',
      body: {
        kind: 'key_result',
        parentGoalId: ctx.ids.goalId,
        title: 'Endpoint coverage above 95%',
        metricName: 'coverage',
        targetValue: '95.0000',
        currentValue: '0.0000',
        unit: '%',
        direction: 'increase',
        status: 'active',
      },
      expect: 201,
    });
  }

  await client.call({
    name: 'a malformed target value is rejected',
    method: 'POST',
    path: '/projects/{id}/goals',
    params: { id },
    actor: 'admin',
    body: { title: 'Bad metric', targetValue: 'many' },
    expect: 400,
  });

  await client.call({
    name: 'user reads the project’s goals',
    method: 'GET',
    path: '/projects/{id}/goals',
    params: { id },
    actor: 'user',
    expect: 200,
    assert: (b) => {
      const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
      return rows.length >= 2
        ? undefined
        : `expected 2 goals, got ${rows.length}`;
    },
  });

  if (ctx.ids.goalId) {
    await client.call({
      name: 'admin records progress against the goal',
      method: 'PATCH',
      path: '/projects/goals/{goalId}',
      params: { goalId: ctx.ids.goalId },
      actor: 'admin',
      body: { currentValue: '42.0000', status: 'at_risk' },
      expect: 200,
      assert: (b) =>
        b?.status === 'at_risk' ? undefined : `status was ${b?.status}`,
    });
  }

  const spare = await client.call({
    name: 'admin creates a disposable goal',
    method: 'POST',
    path: '/projects/{id}/goals',
    params: { id },
    actor: 'admin',
    body: { title: `Disposable goal ${stamp}` },
    expect: 201,
  });
  if (spare.ok) {
    await client.call({
      name: 'admin deletes the disposable goal',
      method: 'DELETE',
      path: '/projects/goals/{goalId}',
      params: { goalId: spare.body.id },
      actor: 'admin',
      expect: 204,
    });
  }
}

async function links(ctx: Ctx): Promise<void> {
  const { client } = ctx;
  if (!ctx.ids.projectId) {
    client.skip(
      'project links',
      '/projects/{id}/contacts',
      'POST',
      'no project',
    );
    return;
  }
  const id = ctx.ids.projectId;

  if (ctx.ids.contactId) {
    const link = await client.call({
      name: 'admin links a contact to the project as the client',
      method: 'POST',
      path: '/projects/{id}/contacts',
      params: { id },
      actor: 'admin',
      body: {
        contactId: ctx.ids.contactId,
        relationship: 'client',
        isPrimary: true,
        note: 'Primary client contact for the fixture project.',
      },
      expect: 201,
    });
    if (link.ok) ctx.ids.projectContactLinkId = link.body.id;

    await client.call({
      name: 'an unknown project/contact relationship is rejected',
      method: 'POST',
      path: '/projects/{id}/contacts',
      params: { id },
      actor: 'admin',
      body: { contactId: ctx.ids.contactId, relationship: 'benefactor' },
      expect: 400,
    });

    await client.call({
      name: 'user reads the project’s linked contacts',
      method: 'GET',
      path: '/projects/{id}/contacts',
      params: { id },
      actor: 'user',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        return rows.length > 0 ? undefined : 'the contact link is not listed';
      },
    });

    // A second, disposable link so the delete path is covered without severing
    // the client relationship the invoices suite bills against.
    if (ctx.ids.contactTwoId) {
      const spare = await client.call({
        name: 'admin links a second contact as a stakeholder',
        method: 'POST',
        path: '/projects/{id}/contacts',
        params: { id },
        actor: 'admin',
        body: { contactId: ctx.ids.contactTwoId, relationship: 'stakeholder' },
        expect: 201,
      });

      if (spare.ok) {
        await client.call({
          name: 'a standard user cannot unlink a project contact',
          method: 'DELETE',
          path: '/projects/{id}/contacts/{linkId}',
          params: { id, linkId: spare.body.id },
          actor: 'user',
          expect: 403,
        });

        await client.call({
          name: 'admin unlinks the stakeholder',
          method: 'DELETE',
          path: '/projects/{id}/contacts/{linkId}',
          params: { id, linkId: spare.body.id },
          actor: 'admin',
          expect: 204,
        });
      }
    }
  }

  if (ctx.ids.knowledgeId) {
    const link = await client.call({
      name: 'admin links a knowledge record to the project',
      method: 'POST',
      path: '/projects/{id}/knowledge',
      params: { id },
      actor: 'admin',
      body: {
        knowledgeId: ctx.ids.knowledgeId,
        relation: 'reference',
        note: 'Incident runbook for this project.',
      },
      expect: 201,
    });
    if (link.ok) ctx.ids.projectKnowledgeLinkId = link.body.id;

    await client.call({
      name: 'user reads the project’s linked knowledge',
      method: 'GET',
      path: '/projects/{id}/knowledge',
      params: { id },
      actor: 'user',
      expect: 200,
      assert: (b) => {
        const rows: any[] = Array.isArray(b) ? b : (b?.data ?? []);
        return rows.length > 0 ? undefined : 'the knowledge link is not listed';
      },
    });

    if (ctx.ids.projectKnowledgeLinkId) {
      await client.call({
        name: 'admin removes the knowledge link',
        method: 'DELETE',
        path: '/projects/{id}/knowledge/{linkId}',
        params: { id, linkId: ctx.ids.projectKnowledgeLinkId },
        actor: 'admin',
        expect: 204,
      });
    }
  }

  await client.call({
    name: 'unbilled time needs project.time.approve, which a user lacks',
    method: 'GET',
    path: '/projects/{id}/unbilled-time',
    params: { id },
    actor: 'user',
    expect: 403,
  });

  await client.call({
    name: 'admin reads unbilled time for the project',
    method: 'GET',
    path: '/projects/{id}/unbilled-time',
    params: { id },
    actor: 'admin',
    expect: 200,
  });
}
