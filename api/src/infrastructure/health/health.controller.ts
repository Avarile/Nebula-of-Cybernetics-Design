import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import type { AppConfig } from '../../config/configurations/app.config';
import { BUILD_INFO } from '../../version';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DatabaseHealthIndicator } from './database.health';
import { MeiliHealthIndicator } from './meili.health';
import { MinioHealthIndicator } from './minio.health';
import { RedisHealthIndicator } from './redis.health';

/** Just enough of the HTTP response to set a status code. */
interface ResponseLike {
  status(code: number): unknown;
}

/**
 * Health probes, split by audience.
 *
 * There used to be one `@Public()` `/health` that hit all four dependencies and
 * returned their raw driver messages — Postgres `ECONNREFUSED 10.0.x.y:5432`,
 * bucket names, Meili errors — to any unauthenticated caller, while also making
 * four network round trips per request.
 *
 *  - `/health/live`  — process only. Public, cheap, and cannot fail.
 *  - `/health/ready` — dependencies, no detail. Public because an orchestrator
 *    cannot authenticate, but it reports only up/down per component.
 *  - `/health`       — full detail including error messages and heap. Admin only.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly heapThreshold: number;

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly minio: MinioHealthIndicator,
    private readonly meili: MeiliHealthIndicator,
    config: ConfigService,
  ) {
    this.heapThreshold =
      config.getOrThrow<AppConfig>('app').healthHeapThresholdBytes;
  }

  @ApiOperation({ summary: 'Liveness probe (process only, cannot fail)' })
  @Public()
  @Get('live')
  @HealthCheck()
  live(): HealthCheckResult {
    // No indicators, by design. Liveness answers one question — is this process
    // still able to serve? — and the honest test of that is whether the request
    // gets answered at all; a wedged event loop never reaches this line.
    //
    // This used to check `heapUsed` against a hardcoded 300 MB. A failing
    // liveness probe makes an orchestrator RESTART the container, so that turned
    // a memory spike into a restart, and sustained memory pressure into a
    // restart loop — the failure mode you least want under load. It also fires
    // on transient pre-GC peaks, killing a process that was about to recover.
    // Container memory limits enforce a real ceiling on RSS from outside the
    // process, which is both stricter and not subject to this race. Heap is
    // still reported, as information, on the admin endpoint below.
    return { status: 'ok', info: {}, error: {}, details: {} };
  }

  @ApiOperation({ summary: 'Readiness probe (dependencies, no detail)' })
  @Public()
  @Get('ready')
  @HealthCheck()
  async ready(
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<HealthCheckResult> {
    // Dependencies only. Heap is deliberately absent here too: a readiness
    // failure pulls the instance out of the load balancer, and shedding a
    // process that is still serving correctly because it is holding memory
    // concentrates the same load onto its peers.
    return this.redact(await this.runDependencyChecks(res));
  }

  @ApiOperation({ summary: 'Full health detail (admin)' })
  @Roles('admin')
  @Get()
  @HealthCheck()
  async check(
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<HealthCheckResult> {
    return this.withBuildInfo(
      await this.runDependencyChecks(res, { includeHeap: true }),
    );
  }

  /**
   * Attach build identity to the report.
   *
   * "Which build is this?" is the first question of most incidents, and the
   * answer otherwise lives only in the orchestrator. It rides on the admin
   * endpoint and not on the public probes on purpose: those deliberately tell
   * an anonymous caller nothing but up/down, and a version number is precisely
   * where CVE-matching starts. It is attached after the checks rather than
   * registered as an indicator because it cannot fail, and anything passed to
   * `HealthCheckService.check` can drag the overall status down with it.
   */
  private withBuildInfo(result: HealthCheckResult): HealthCheckResult {
    const build = { status: 'up', ...BUILD_INFO };
    return {
      ...result,
      info: { ...result.info, build },
      details: { ...result.details, build },
    } as HealthCheckResult;
  }

  /**
   * Run the dependency indicators and return the result — including when it is
   * a failure.
   *
   * `HealthCheckService.check` signals "unhealthy" by THROWING
   * `ServiceUnavailableException` with the report as its payload. The app's
   * `@Catch()`-everything `GlobalExceptionFilter` then rewrote that into the
   * generic error envelope, so both endpoints answered a genuine outage with
   * `{"error":{"code":"DEPENDENCY_UNAVAILABLE"}}` and no per-component detail —
   * losing exactly the information they exist to carry, on the only path where
   * anyone needs it. Catching it here keeps the report and still answers 503.
   */
  private async runDependencyChecks(
    res: ResponseLike,
    { includeHeap = false }: { includeHeap?: boolean } = {},
  ): Promise<HealthCheckResult> {
    const indicators = [
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.minio.isHealthy('minio'),
      () => this.meili.isHealthy('meilisearch'),
      ...(includeHeap
        ? [() => this.memory.checkHeap('memory_heap', this.heapThreshold)]
        : []),
    ];

    try {
      return await this.health.check(indicators);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        res.status(503);
        return error.getResponse() as HealthCheckResult;
      }
      throw error;
    }
  }

  /**
   * Strip everything but `status` from each component.
   *
   * The indicators attach the underlying driver message on failure, which is
   * useful to an operator and is reconnaissance to anyone else — host/port of
   * the database, bucket names, internal error text.
   */
  private redact(result: HealthCheckResult): HealthCheckResult {
    const statusOnly = (
      entries: Record<string, { status: string } | undefined> = {},
    ): Record<string, { status: string }> => {
      const out: Record<string, { status: string }> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (value) out[key] = { status: value.status };
      }
      return out;
    };
    return {
      status: result.status,
      info: statusOnly(result.info),
      error: statusOnly(result.error),
      details: statusOnly(result.details),
    } as HealthCheckResult;
  }
}
