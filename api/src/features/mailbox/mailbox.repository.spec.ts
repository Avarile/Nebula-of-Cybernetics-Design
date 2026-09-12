import { MailboxRepository } from './mailbox.repository';

function selectChain(result: any[]) {
  const chain: any = {
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    offset: jest.fn(async () => result),
  };
  // allow `await select().from().where().limit()` (no offset) too:
  chain.limit = jest.fn(() => Object.assign(Promise.resolve(result), chain));
  return chain;
}

describe('MailboxRepository', () => {
  it('findByUid filters and returns the row or null', async () => {
    const row = { id: 'm1' };
    const db: any = { select: jest.fn(() => selectChain([row])) };
    const repo = new MailboxRepository(db);
    expect(await repo.findByUid('acc', 'INBOX', 1, 7)).toEqual(row);
  });

  it('insertMessageWithAttachments runs inside one transaction', async () => {
    const inserted = { id: 'm1' };
    const tx: any = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({ returning: jest.fn(async () => [inserted]) })),
      })),
    };
    const db: any = { transaction: jest.fn(async (fn: any) => fn(tx)) };
    const repo = new MailboxRepository(db);
    const res = await repo.insertMessageWithAttachments(
      {
        accountId: 'acc',
        mailbox: 'INBOX',
        uid: 7,
        uidValidity: 1,
        receivedAt: new Date(),
      } as any,
      [{ fileId: 'f1', contentType: 'application/pdf', size: 8 } as any],
    );
    expect(db.transaction).toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(2); // message + attachment
    expect(res).toEqual(inserted);
  });

  it('listForReindex issues the filtered/ordered/limited select', async () => {
    const rows = [{ id: 'm1' }, { id: 'm2' }];
    const chain = selectChain(rows);
    const db: any = { select: jest.fn(() => chain) };
    const repo = new MailboxRepository(db);
    const cutoff = new Date('2024-01-01');
    const res = await repo.listForReindex('acc', 'INBOX', cutoff, 500);
    expect(db.select).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
    expect(chain.orderBy).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(500);
    expect(res).toEqual(rows);
  });
});
