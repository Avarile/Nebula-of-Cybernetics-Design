import { haltWorkerIfApiOnly, workersEnabled } from './worker-role';

describe('workersEnabled', () => {
  const original = process.env.WORKER_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_ENABLED;
    else process.env.WORKER_ENABLED = original;
  });

  // The default must stay "run everything", so a single-process deployment
  // behaves exactly as it did before the flag existed.
  it.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('WORKER_ENABLED=%s -> %s', (value, expected) => {
    if (value === undefined) delete process.env.WORKER_ENABLED;
    else process.env.WORKER_ENABLED = value;
    expect(workersEnabled()).toBe(expected);
  });
});

describe('haltWorkerIfApiOnly', () => {
  const original = process.env.WORKER_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_ENABLED;
    else process.env.WORKER_ENABLED = original;
  });

  it('leaves the worker running by default', () => {
    delete process.env.WORKER_ENABLED;
    const worker = { close: jest.fn(async () => undefined) };
    const log = jest.fn();
    expect(haltWorkerIfApiOnly(worker, log)).toBe(false);
    expect(worker.close).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  // Gating only the schedulers would stop job production while every replica
  // kept consuming — which is the fan-out this exists to remove.
  it('closes the worker and says so when API-only', () => {
    process.env.WORKER_ENABLED = 'false';
    const worker = { close: jest.fn(async () => undefined) };
    const log = jest.fn();
    expect(haltWorkerIfApiOnly(worker, log)).toBe(true);
    expect(worker.close).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('WORKER_ENABLED'));
  });

  it('tolerates a worker that has not been created', () => {
    process.env.WORKER_ENABLED = 'false';
    expect(haltWorkerIfApiOnly(undefined, jest.fn())).toBe(true);
  });
});
