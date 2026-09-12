import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SYSTEM_PRINCIPAL, type Principal } from '../../common/principal';
import { ContactService } from './contact.service';

const owner: Principal = { kind: 'user', userId: 'owner', role: 'user' };
const other: Principal = { kind: 'user', userId: 'other', role: 'user' };

function makeContact(overrides: Record<string, any> = {}) {
  return {
    id: 'c1',
    displayName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
    primaryEmail: 'ada@example.com',
    emailNormalized: 'ada@example.com',
    ownerUserId: 'owner',
    visibility: 'private',
    status: 'active',
    source: 'manual',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('ContactService', () => {
  let repo: any;
  let tags: any;
  let contacts: ContactService;

  beforeEach(() => {
    repo = {
      upsertByEmail: jest.fn(async (v: any) => makeContact(v)),
      findLiveById: jest.fn(async () => makeContact()),
      list: jest.fn(async () => ({ rows: [makeContact()], total: 1 })),
      update: jest.fn(async (_id: string, p: any) => makeContact(p)),
      softDelete: jest.fn(async () => undefined),
      setTags: jest.fn(async () => undefined),
      tagIdsFor: jest.fn(async () => []),
      listChannels: jest.fn(async () => []),
      addChannel: jest.fn(async (v: any) => v),
      removeChannel: jest.fn(async () => true),
      clearPrimary: jest.fn(async () => undefined),
    };
    tags = { resolveForScope: jest.fn(async () => []) };
    contacts = new ContactService(
      repo,
      tags,
      { recordSafe: jest.fn(async () => undefined) } as never,
      {
        purgeFor: jest.fn(async () => ({ comments: 0, attachments: 0 })),
      } as never,
      new ExceptionService(),
    );
  });

  describe('creation', () => {
    it('always writes through the dedup upsert, never a plain insert', async () => {
      // A bare insert would fail the partial unique index on valid mail.
      await contacts.create(
        { displayName: 'Ada', primaryEmail: 'ada@example.com' } as never,
        owner,
      );
      expect(repo.upsertByEmail).toHaveBeenCalled();
    });

    it('derives a display name from the name parts', async () => {
      await contacts.create(
        { firstName: 'Ada', lastName: 'Lovelace' } as never,
        owner,
      );
      expect(repo.upsertByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Ada Lovelace' }),
      );
    });

    it('falls back to the email when there is no name at all', async () => {
      await contacts.create(
        { primaryEmail: 'ada@example.com' } as never,
        owner,
      );
      expect(repo.upsertByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'ada@example.com' }),
      );
    });

    it('records the creating user as the owner', async () => {
      await contacts.create({ displayName: 'Ada' } as never, owner);
      expect(repo.upsertByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: 'owner' }),
      );
    });

    it('leaves a pipeline-created contact unowned', async () => {
      // `system` has no users.id; writing one would violate the foreign key.
      await contacts.create({ displayName: 'Ada' } as never, SYSTEM_PRINCIPAL);
      expect(repo.upsertByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: null }),
      );
    });

    it('validates tag scope before writing anything', async () => {
      tags.resolveForScope.mockRejectedValueOnce(new Error('wrong scope'));
      await expect(
        contacts.create({ displayName: 'Ada', tagIds: ['t1'] } as never, owner),
      ).rejects.toThrow('wrong scope');
      expect(repo.upsertByEmail).not.toHaveBeenCalled();
    });
  });

  describe('ingest', () => {
    it('upserts by email and claims no owner', async () => {
      await contacts.ingestByEmail({
        email: 'new@example.com',
        source: 'inbound_email',
      });
      expect(repo.upsertByEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryEmail: 'new@example.com',
          source: 'inbound_email',
          ownerUserId: null,
        }),
      );
    });
  });

  describe('scope', () => {
    it("hides another user's private contact as NOT_FOUND", async () => {
      await expect(contacts.get('c1', other)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('lets a reader of a shared contact read but not change it', async () => {
      repo.findLiveById.mockResolvedValue(
        makeContact({ visibility: 'shared' }),
      );
      await expect(contacts.get('c1', other)).resolves.toBeDefined();
      await expect(
        contacts.update('c1', { jobTitle: 'x' } as never, other),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('narrows a non-admin list query in SQL', async () => {
      await contacts.list({ page: 1, limit: 10 } as never, other);
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ visibleTo: 'other' }),
      );
    });

    it('does not narrow for an admin', async () => {
      await contacts.list({ page: 1, limit: 10 } as never, {
        kind: 'user',
        userId: 'a1',
        role: 'admin',
      });
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ visibleTo: undefined }),
      );
    });
  });

  describe('update', () => {
    it('moves the dedup key when the email changes', async () => {
      // Leaving emailNormalized behind would keep matching the old address on
      // the next ingest.
      await contacts.update(
        'c1',
        { primaryEmail: 'NEW@Example.com ' } as never,
        owner,
      );
      expect(repo.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ emailNormalized: 'new@example.com' }),
      );
    });

    it('clears the dedup key when the email is removed', async () => {
      await contacts.update('c1', { primaryEmail: null } as never, owner);
      expect(repo.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ emailNormalized: null }),
      );
    });
  });

  it('cascades comments and attachments on delete', async () => {
    const cascade = {
      purgeFor: jest.fn(async () => ({ comments: 1, attachments: 0 })),
    };
    const svc = new ContactService(
      repo,
      tags,
      { recordSafe: jest.fn(async () => undefined) } as never,
      cascade as never,
      new ExceptionService(),
    );
    await svc.remove('c1', owner);
    expect(cascade.purgeFor).toHaveBeenCalledWith('contact', 'c1');
  });

  it('clears an existing primary before setting a new one', async () => {
    await contacts.addChannel(
      'c1',
      { kind: 'email', value: 'x@y.com', isPrimary: true } as never,
      owner,
    );
    expect(repo.clearPrimary).toHaveBeenCalledWith('c1', 'email');
  });
});
