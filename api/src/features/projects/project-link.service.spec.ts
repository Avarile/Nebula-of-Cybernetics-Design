import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SYSTEM_PRINCIPAL, type Principal } from '../../common/principal';
import { ProjectLinkService } from './project-link.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const service: Principal = {
  kind: 'service',
  credentialId: 'c1',
  role: 'agent',
};

function serviceWith(repo: Record<string, unknown>) {
  const projects = { require: jest.fn(async () => undefined) };
  const svc = new ProjectLinkService(
    repo as never,
    projects as never,
    {} as never, // contacts
    {} as never, // tasks
    {} as never, // activity
    new ExceptionService(),
  );
  return { svc, projects };
}

/**
 * Unlinking must stay inside the project it was authorized against.
 *
 * The regression: both methods took a `projectId`, checked the caller against
 * it, and then soft-deleted a `linkId` that was never constrained to it — so a
 * contributor on one project could strip references off any other.
 */
describe('ProjectLinkService unlink scoping', () => {
  it('scopes a knowledge unlink to the authorized project', async () => {
    const repo = { unlinkKnowledge: jest.fn(async () => true) };
    const { svc } = serviceWith(repo);
    await svc.unlinkKnowledge('proj-a', 'link-1', user);
    expect(repo.unlinkKnowledge).toHaveBeenCalledWith('link-1', 'proj-a');
  });

  it('scopes a contact unlink to the authorized project', async () => {
    const repo = { unlinkContact: jest.fn(async () => true) };
    const { svc } = serviceWith(repo);
    await svc.unlinkContact('proj-a', 'link-1', user);
    expect(repo.unlinkContact).toHaveBeenCalledWith('link-1', 'proj-a');
  });

  it('404s on a knowledge link belonging to another project', async () => {
    const repo = { unlinkKnowledge: jest.fn(async () => false) };
    const { svc } = serviceWith(repo);
    await expect(
      svc.unlinkKnowledge('proj-a', 'link-owned-by-b', user),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('404s on a contact link belonging to another project', async () => {
    const repo = { unlinkContact: jest.fn(async () => false) };
    const { svc } = serviceWith(repo);
    await expect(
      svc.unlinkContact('proj-a', 'link-owned-by-b', user),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

/**
 * `listTime` narrows by project, or by the caller's own user id. A principal
 * that is neither used to fall through both branches to an unfiltered query
 * over every hour anyone had logged. Only `@Roles('user','admin')` on the route
 * kept service credentials away from it; a guard is not a substitute for the
 * query failing closed on its own.
 */
describe('ProjectLinkService.listTime scoping', () => {
  const page = { page: 1, limit: 50 };

  it('narrows to the caller when no project is given', async () => {
    const repo = {
      listTimeEntries: jest.fn(async () => ({ rows: [], total: 0 })),
    };
    const { svc } = serviceWith(repo);
    await svc.listTime(page as never, user);
    expect(repo.listTimeEntries).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
  });

  it('refuses an unscoped listing for a service credential', async () => {
    const repo = { listTimeEntries: jest.fn() };
    const { svc } = serviceWith(repo);
    await expect(svc.listTime(page as never, service)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(repo.listTimeEntries).not.toHaveBeenCalled();
  });

  it('refuses an unscoped listing for the system principal', async () => {
    const repo = { listTimeEntries: jest.fn() };
    const { svc } = serviceWith(repo);
    await expect(
      svc.listTime(page as never, SYSTEM_PRINCIPAL),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(repo.listTimeEntries).not.toHaveBeenCalled();
  });

  it('still allows a project-scoped listing for any principal', async () => {
    const repo = {
      listTimeEntries: jest.fn(async () => ({ rows: [], total: 0 })),
    };
    const { svc, projects } = serviceWith(repo);
    await svc.listTime({ ...page, projectId: 'p1' } as never, service);
    expect(projects.require).toHaveBeenCalledWith('p1', service, 'viewer');
    expect(repo.listTimeEntries).toHaveBeenCalled();
  });
});
