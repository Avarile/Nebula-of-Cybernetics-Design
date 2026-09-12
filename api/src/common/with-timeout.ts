/** Raised by {@link withTimeout} when the wrapped promise outlives its budget. */
export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * Needed wherever an ioredis command is awaited on a request path. ioredis
 * defaults to `enableOfflineQueue: true`, so while the server is unreachable a
 * command is **queued rather than rejected** — it neither resolves nor throws.
 * Awaiting it directly turns a Redis outage into hung requests instead of failed
 * ones, which is strictly worse than either failing open or failing closed,
 * because nothing upstream can react to it.
 *
 * A distinct `TimeoutError` (rather than a bare `Error`) lets callers tell "the
 * dependency is unreachable" apart from "the dependency said no".
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    // Always cleared, including when the promise wins — a surviving timer keeps
    // the event loop alive and, under Jest, hangs the worker.
    if (timer) clearTimeout(timer);
  }
}
