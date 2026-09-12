import {
  goals,
  milestones,
  projectMemberRole,
  projectMembers,
  projectStatus,
  projectVisibility,
  projects,
  taskDependencies,
  taskStatus,
  taskWatchers,
  tasks,
} from './project.schema';

describe('project schema', () => {
  it('defines the project and task status vocabularies', () => {
    expect(projectStatus.enumValues).toEqual([
      'draft',
      'active',
      'on_hold',
      'completed',
      'archived',
      'cancelled',
    ]);
    expect(taskStatus.enumValues).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'blocked',
      'in_review',
      'done',
      'cancelled',
    ]);
  });

  it('orders member roles from most to least privileged', () => {
    expect(projectMemberRole.enumValues).toEqual([
      'owner',
      'manager',
      'contributor',
      'viewer',
    ]);
  });

  it('defaults a project to private', () => {
    // Fail closed: a project that declares no policy must be invisible.
    expect(projectVisibility.enumValues).toEqual(['private', 'internal']);
    expect(projects.visibility.default).toBe('private');
  });

  it('requires every task to belong to a project', () => {
    // A project-less task has no membership to inherit and would need its own
    // ACL — a second authorization path for a minority of rows.
    expect(tasks.projectId.notNull).toBe(true);
  });

  it('exposes the remaining project tables', () => {
    expect(projectMembers).toBeDefined();
    expect(milestones).toBeDefined();
    expect(goals).toBeDefined();
    expect(taskDependencies).toBeDefined();
    expect(taskWatchers).toBeDefined();
  });
});
