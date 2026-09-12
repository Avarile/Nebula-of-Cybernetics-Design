import { ReaperService } from './reaper.service';

describe('ReaperService', () => {
  it('reports what it recovered', async () => {
    // Crash recovery in one statement: nothing has to be cleaned up BY the
    // process that crashed, which is the only cleanup that can be relied on.
    const jobs = {
      reapExpiredLeases: jest
        .fn()
        .mockResolvedValue({ requeued: 3, deadLettered: 1 }),
    };
    const reaper = new ReaperService(jobs as never);
    await expect(reaper.run()).resolves.toEqual({
      requeued: 3,
      deadLettered: 1,
    });
  });

  it('does nothing when no lease has expired', async () => {
    const jobs = {
      reapExpiredLeases: jest
        .fn()
        .mockResolvedValue({ requeued: 0, deadLettered: 0 }),
    };
    const reaper = new ReaperService(jobs as never);
    await expect(reaper.run()).resolves.toEqual({
      requeued: 0,
      deadLettered: 0,
    });
  });
});
