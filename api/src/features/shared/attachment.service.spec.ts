import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { AttachmentService } from './attachment.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };

const dto = {
  entityType: 'project' as const,
  entityId: 'p1',
  fileId: 'f1',
  kind: 'document' as const,
  sortOrder: 0,
};

describe('AttachmentService', () => {
  let repo: any;
  let access: any;
  let files: any;
  let attachments: AttachmentService;

  beforeEach(() => {
    repo = {
      findPair: jest.fn(async () => null),
      findLiveById: jest.fn(async () => ({
        id: 'a1',
        entityType: 'project',
        entityId: 'p1',
        fileId: 'f1',
      })),
      create: jest.fn(async (v: any) => ({
        id: 'a1',
        createdAt: new Date(),
        ...v,
      })),
      listForEntity: jest.fn(async () => ({ rows: [], total: 0 })),
      softDelete: jest.fn(async () => undefined),
      countReferences: jest.fn(async () => 0),
    };
    access = { canRead: jest.fn(async () => true) };
    files = {
      getMetadata: jest.fn(async () => ({
        id: 'f1',
        filename: 'spec.pdf',
        status: 'AVAILABLE',
      })),
    };
    attachments = new AttachmentService(
      repo,
      access,
      files,
      { recordSafe: jest.fn(async () => undefined) } as never,
      new ExceptionService(),
    );
  });

  it('requires read access to the parent entity', async () => {
    access.canRead.mockResolvedValueOnce(false);
    await expect(attachments.attach(dto as never, user)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(files.getMetadata).not.toHaveBeenCalled();
  });

  it('requires read access to the file, delegated to FileService', async () => {
    // Checking only the parent would let a caller attach someone else's file to
    // a record they own.
    files.getMetadata.mockRejectedValueOnce(new Error('FILE_NOT_FOUND'));
    await expect(attachments.attach(dto as never, user)).rejects.toThrow(
      'FILE_NOT_FOUND',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a file that is not AVAILABLE', async () => {
    files.getMetadata.mockResolvedValueOnce({
      id: 'f1',
      filename: 'x',
      status: 'QUARANTINED',
    });
    await expect(attachments.attach(dto as never, user)).rejects.toMatchObject({
      code: ErrorCode.FILE_INVALID_STATE,
    });
  });

  it('refuses to attach the same file twice', async () => {
    repo.findPair.mockResolvedValueOnce({ id: 'existing' });
    await expect(attachments.attach(dto as never, user)).rejects.toMatchObject({
      code: ErrorCode.ATTACHMENT_EXISTS,
    });
  });

  it('records who attached it', async () => {
    await attachments.attach(dto as never, user);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ attachedBy: 'u1' }),
    );
  });

  it('answers whether a file is still referenced, for the orphan sweep', async () => {
    repo.countReferences.mockResolvedValueOnce(2);
    await expect(attachments.isReferenced('f1')).resolves.toBe(true);
    repo.countReferences.mockResolvedValueOnce(0);
    await expect(attachments.isReferenced('f1')).resolves.toBe(false);
  });

  it('re-checks parent access before detaching', async () => {
    access.canRead.mockResolvedValueOnce(false);
    await expect(attachments.detach('a1', user)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(repo.softDelete).not.toHaveBeenCalled();
  });
});
