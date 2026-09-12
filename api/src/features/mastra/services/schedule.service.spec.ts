import { ExceptionService } from '../../../infrastructure/exceptions';
import { ScheduleService } from './schedule.service';

function make(schedulesEnabled = true) {
  const repo = {
    create: jest.fn(async (v: any) => ({ id: 'sch-1', enabled: true, ...v })),
    listEnabled: jest.fn(async () => [
      { id: 'sch-1', cron: '*/5 * * * *', enabled: true },
    ]),
    findLiveById: jest.fn(async () => ({ id: 'sch-1', cron: '*/5 * * * *' })),
    softDelete: jest.fn(async () => undefined),
  };
  const queue = {
    upsertJobScheduler: jest.fn(async () => undefined),
    removeJobScheduler: jest.fn(async () => undefined),
  };
  const config = { getOrThrow: () => ({ schedulesEnabled }) };
  return {
    service: new ScheduleService(
      repo as never,
      queue as never,
      config as never,
      new ExceptionService(),
    ),
    repo,
    queue,
  };
}

describe('ScheduleService', () => {
  it('creates a schedule and registers a job scheduler when enabled', async () => {
    const { service, queue } = make();
    await service.create({
      name: 'daily',
      cron: '0 9 * * *',
      agentId: 'orchestrator',
      promptTemplate: 'report',
    } as any);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'sch-1',
      expect.objectContaining({ pattern: '0 9 * * *' }),
      expect.objectContaining({
        name: 'run-schedule',
        data: expect.objectContaining({ scheduleId: 'sch-1' }),
        opts: expect.objectContaining({ attempts: 3 }),
      }),
    );
  });

  it('syncRepeatableJobs registers all enabled schedules', async () => {
    const { service, queue } = make();
    await service.syncRepeatableJobs();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('remove soft-deletes the schedule and removes its job scheduler', async () => {
    const { service, repo, queue } = make();
    await service.remove('sch-1');
    expect(repo.softDelete).toHaveBeenCalledWith('sch-1');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('sch-1');
  });
});

describe('ScheduleService — kill-switch and cron validation', () => {
  // The switch guarded only the boot-time sync, so it survived exactly until an
  // admin created a schedule through the API.
  it('does not register a repeatable when schedules are disabled', async () => {
    const { service, queue, repo } = make(false);
    await service.create({
      name: 'daily',
      cron: '0 9 * * *',
      agentId: 'orchestrator',
      promptTemplate: 'report',
    } as never);
    expect(repo.create).toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('skips the boot sync when schedules are disabled', async () => {
    const { service, queue } = make(false);
    await service.syncRepeatableJobs();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  // Registration used to run after the insert, so a typo persisted a schedule
  // that failed here and again on every later boot.
  it('rejects an invalid cron before writing the row', async () => {
    const { service, repo, queue } = make();
    await expect(
      service.create({
        name: 'bad',
        cron: 'every tuesday',
        agentId: 'orchestrator',
        promptTemplate: 'report',
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.create).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
