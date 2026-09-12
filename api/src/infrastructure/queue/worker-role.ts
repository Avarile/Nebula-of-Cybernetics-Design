/**
 * Whether this process should run background workers and schedulers.
 *
 * Every replica used to run every `@Processor` and register every repeatable, so
 * scaling the HTTP tier to N replicas multiplied the workers N-fold — all
 * sharing one Postgres pool. The schedulers were idempotent (stable
 * `upsertJobScheduler` ids), so cron did not duplicate, but the worker fan-out
 * was unbounded.
 *
 * Read from the environment directly rather than through `ConfigService`: this
 * is consulted by `@Processor` concurrency wiring and bootstrap hooks that run
 * before, or outside of, request-scoped config injection.
 *
 *  - unset / `true`  → run workers (the single-process default; nothing changes)
 *  - `false`         → API-only: serve HTTP, register nothing, consume nothing
 */
export function workersEnabled(): boolean {
  const raw = process.env.WORKER_ENABLED;
  if (raw === undefined || raw === '') return true;
  return raw === 'true' || raw === '1';
}

/**
 * Stop a BullMQ worker from consuming when this process is API-only.
 *
 * Gating the schedulers alone would only stop job *production*; every replica
 * would still consume, which is the fan-out this exists to remove. Call from a
 * processor's `onModuleInit`, where `WorkerHost.worker` is available.
 */
export function haltWorkerIfApiOnly(
  worker: { close(): Promise<void> } | undefined,
  onHalt: (message: string) => void,
): boolean {
  if (workersEnabled()) return false;
  onHalt('WORKER_ENABLED=false — not consuming jobs in this process');
  // Fire-and-forget: `onModuleInit` should not block boot on a Redis round trip.
  void worker?.close();
  return true;
}
