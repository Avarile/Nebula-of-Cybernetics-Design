import { ActionLogRepository } from './action-log.repository';

describe('ActionLogRepository.record', () => {
  it('throws and does not insert when runId is null', async () => {
    const values = jest.fn(async () => undefined);
    const db = { insert: jest.fn(() => ({ values })) };
    const repo = new ActionLogRepository(db as never);

    await expect(
      repo.record({
        runId: null,
        conversationId: 'c1',
        actorUserId: 'u1',
        actionType: 'send_email',
        toolId: 'send-email',
        status: 'success',
        summary: 's',
      } as never),
    ).rejects.toThrow('ActionLogRepository.record requires a runId');

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts via db.insert(table).values(entry) when runId is present', async () => {
    const values = jest.fn(async () => undefined);
    const db = { insert: jest.fn(() => ({ values })) };
    const repo = new ActionLogRepository(db as never);

    const entry = {
      runId: 'run-1',
      conversationId: 'c1',
      actorUserId: 'u1',
      actionType: 'send_email',
      toolId: 'send-email',
      status: 'success',
      summary: 's',
    } as never;

    await repo.record(entry);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(entry);
  });
});
