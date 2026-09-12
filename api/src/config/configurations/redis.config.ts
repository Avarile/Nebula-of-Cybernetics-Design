import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

export const redisConfig = registerAs('redis', () => {
  const env = validateEnv(process.env);
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    /**
     * Ceiling on one Redis command, used in BOTH places that bound one: ioredis'
     * own `commandTimeout` and the `withTimeout` race the cache services put around
     * every call. One number because two disagreeing ones are not two layers of
     * safety — the tighter one simply decides, and the looser one never runs.
     *
     * Sized against scheduling delay, not just the network. The budget is measured
     * by a timer on the caller's event loop, so a loop blocked longer than the
     * budget (argon2 on the login path, a saturated CI box) expires it even when
     * Redis answered in single-digit milliseconds. It was 200ms compiled into two
     * services, which against a remote Redis meant a starved process reported the
     * cache as unreachable and `TokenValidityService` fail-closed a 503 on a
     * perfectly healthy system.
     *
     * Raise it for a slow link or a busy host; lowering it below the p99 round-trip
     * plus expected loop lag buys nothing and costs false outages.
     */
    commandTimeoutMs: intEnv('REDIS_COMMAND_TIMEOUT_MS', 1_000),
  };
});

export type RedisConfig = ReturnType<typeof redisConfig>;

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}
