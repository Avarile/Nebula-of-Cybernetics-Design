import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { CommentService } from './comment.service';

const author: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const other: Principal = { kind: 'user', userId: 'u2', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };

function makeComment(overrides: Record<string, any> = {}) {
  return {
    id: 'c1',
    entityType: 'task',
    entityId: 'task-1',
    parentCommentId: null,
    authorUserId: 'u1',
    authorKind: 'user',
    body: 'hello',
    mentions: [],
    editedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

describe('CommentService', () => {
  let repo: any;
  let access: any;
  let activity: any;
  let comments: CommentService;

  beforeEach(() => {
    repo = {
      create: jest.fn(async (v: any) => makeComment(v)),
      findLiveById: jest.fn(async () => makeComment()),
      list: jest.fn(async () => ({ rows: [makeComment()], total: 1 })),
      update: jest.fn(async (_id: string, p: any) => makeComment(p)),
      softDelete: jest.fn(async () => undefined),
      filterLiveUserIds: jest.fn(async () => []),
    };
    access = { canRead: jest.fn(async () => true) };
    activity = { recordSafe: jest.fn(async () => undefined) };
    comments = new CommentService(
      repo,
      access,
      activity,
      new ExceptionService(),
    );
  });

  const dto = {
    entityType: 'task' as const,
    entityId: 'task-1',
    body: 'hello',
    mentionUserIds: [],
  };

  it('refuses to comment on an entity the caller cannot read', async () => {
    access.canRead.mockResolvedValueOnce(false);
    await expect(comments.create(dto as never, other)).rejects.toMatchObject({
      // NOT_FOUND, not FORBIDDEN: confirming existence is itself a disclosure.
      code: ErrorCode.NOT_FOUND,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses to list comments on an entity the caller cannot read', async () => {
    access.canRead.mockResolvedValueOnce(false);
    await expect(
      comments.list(
        { entityType: 'task', entityId: 'task-1', page: 1, limit: 10 },
        other,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('drops mention ids that do not name a live user', async () => {
    repo.filterLiveUserIds.mockResolvedValueOnce(['u2']);
    await comments.create(
      { ...dto, mentionUserIds: ['u2', 'ghost'] } as never,
      author,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ mentions: ['u2'] }),
    );
  });

  it('flattens a reply-to-a-reply onto its parent', async () => {
    repo.findLiveById.mockResolvedValueOnce(
      makeComment({ id: 'c2', parentCommentId: 'c1' }),
    );
    await comments.create({ ...dto, parentCommentId: 'c2' } as never, author);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentCommentId: 'c1' }),
    );
  });

  it('rejects a parent comment belonging to another entity', async () => {
    repo.findLiveById.mockResolvedValueOnce(
      makeComment({ id: 'c9', entityId: 'other-task' }),
    );
    await expect(
      comments.create({ ...dto, parentCommentId: 'c9' } as never, author),
    ).rejects.toMatchObject({ code: ErrorCode.COMMENT_NOT_FOUND });
  });

  it('lets only the author edit, including admins', async () => {
    await expect(
      comments.update('c1', { body: 'edited' } as never, other),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      comments.update('c1', { body: 'edited' } as never, admin),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      comments.update('c1', { body: 'edited' } as never, author),
    ).resolves.toMatchObject({ body: 'edited' });
  });

  it('stamps editedAt on an edit', async () => {
    await comments.update('c1', { body: 'edited' } as never, author);
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ editedAt: expect.any(Date) }),
    );
  });

  it('lets the author or an admin delete, but not a third party', async () => {
    await expect(comments.remove('c1', other)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    await expect(comments.remove('c1', admin)).resolves.toBeUndefined();
    await expect(comments.remove('c1', author)).resolves.toBeUndefined();
  });
});
