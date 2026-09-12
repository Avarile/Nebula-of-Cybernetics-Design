import { TimeoutError, withTimeout } from './with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('propagates the original rejection rather than masking it as a timeout', async () => {
    const boom = new Error('upstream failed');
    await expect(withTimeout(Promise.reject(boom), 50)).rejects.toBe(boom);
  });

  /**
   * The case this helper exists for. ioredis defaults to
   * `enableOfflineQueue: true`, so while Redis is unreachable a command neither
   * resolves nor rejects — it queues. Awaiting it directly would hang the
   * caller indefinitely; here that must become a prompt, catchable failure.
   */
  it('rejects with a TimeoutError when the promise never settles', async () => {
    jest.useFakeTimers();
    const pending = new Promise<never>(() => {
      /* never settles, like a queued ioredis command */
    });
    const raced = withTimeout(pending, 200);
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(200);
    await assertion;
  });

  it('names the elapsed budget in the error, so logs say what timed out', async () => {
    jest.useFakeTimers();
    const raced = withTimeout(new Promise<never>(() => {}), 750);
    const assertion = expect(raced).rejects.toThrow(/750ms/);
    await jest.advanceTimersByTimeAsync(750);
    await assertion;
  });

  it('does not leave the timer pending after the promise wins the race', async () => {
    jest.useFakeTimers();
    await expect(withTimeout(Promise.resolve(1), 1_000)).resolves.toBe(1);
    // A leaked timer would keep the event loop (and, in Jest, the worker) alive.
    expect(jest.getTimerCount()).toBe(0);
  });
});
