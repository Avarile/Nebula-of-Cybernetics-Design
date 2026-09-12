import { PasswordResetRepository } from './password-reset.repository';

/** Minimal chainable Drizzle mock. Each terminal returns the queued result. */
function makeDb() {
  const state: any = { lastInsertValues: null };
  const db: any = {
    insert: jest.fn(() => ({
      values: jest.fn((v: any) => {
        state.lastInsertValues = v;
        return { returning: jest.fn(async () => [{ id: 'r1', ...v }]) };
      }),
    })),
    select: jest.fn(() => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => state.selectResult ?? [],
      };
      return chain;
    }),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({
          returning: jest.fn(
            async () => state.updateResult ?? [{ attemptCount: 3 }],
          ),
        })),
      })),
    })),
    delete: jest.fn(() => ({
      where: jest.fn(() => ({
        returning: jest.fn(async () => state.deleteResult ?? []),
      })),
    })),
  };
  return { db, state };
}

describe('PasswordResetRepository', () => {
  it('insert stores the row and returns it', async () => {
    const { db } = makeDb();
    const repo = new PasswordResetRepository(db);
    const row = await repo.insert({
      userId: 'u1',
      codeHash: 'h',
      expiresAt: new Date('2030-01-01'),
    } as any);
    expect(db.insert).toHaveBeenCalled();
    expect(row).toEqual(expect.objectContaining({ id: 'r1', userId: 'u1' }));
  });

  it('findLiveByUser returns null when none live', async () => {
    const { db, state } = makeDb();
    state.selectResult = [];
    const repo = new PasswordResetRepository(db);
    expect(await repo.findLiveByUser('u1')).toBeNull();
  });

  it('findLiveByUser returns the live row', async () => {
    const { db, state } = makeDb();
    state.selectResult = [{ id: 'r1', userId: 'u1', consumedAt: null }];
    const repo = new PasswordResetRepository(db);
    expect(await repo.findLiveByUser('u1')).toEqual(
      expect.objectContaining({ id: 'r1' }),
    );
  });

  it('incrementAttempts returns the new count', async () => {
    const { db, state } = makeDb();
    state.updateResult = [{ attemptCount: 4 }];
    const repo = new PasswordResetRepository(db);
    expect(await repo.incrementAttempts('r1')).toBe(4);
  });

  it('consumeAllForUser and consume issue updates; deleteExpired issues a delete', async () => {
    const { db } = makeDb();
    const repo = new PasswordResetRepository(db);
    await repo.consumeAllForUser('u1');
    await repo.consume('r1');
    await repo.deleteExpired(new Date('2020-01-01'));
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
