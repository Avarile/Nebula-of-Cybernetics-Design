import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { PasswordResetRepository } from '../password-reset.repository';
import { SessionRepository } from '../session.repository';
import {
  AUTH_CLEANUP_JOB,
  AUTH_CLEANUP_QUEUE,
  AUTH_CLEANUP_SCHEDULER_ID,
} from '../auth.constants';
import {
  haltWorkerIfApiOnly,
  workersEnabled,
} from '../../../infrastructure/queue/worker-role';

/** How often the sweep runs, and how long terminal rows are kept. */
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000; // 6h
const SESSION_RETENTION_DAYS = 30;

/**
 * Reclaims terminal auth rows.
 *
 * `sessions` gains a row per login per device and never lost one: revoked and
 * long-expired rows accumulated forever. `password_reset_codes` was worse —
 * `PasswordResetRepository.deleteExpired` existed and was unit-tested, but had
 * no production caller at all, so every reset code ever issued was still there.
 *
 * Both tables are pure bookkeeping past their expiry, and neither is an audit
 * trail (`system_audit_log` is), so deleting them loses nothing. Expired
 * sessions are kept for a retention window rather than dropped immediately, so
 * `GET /auth/sessions` and any incident review still see recent history.
 */
@Injectable()
export class AuthCleanupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthCleanupScheduler.name);

  constructor(@InjectQueue(AUTH_CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    try {
      // `upsertJobScheduler` keyed by a stable id, so re-registering on every
      // boot updates in place instead of orphaning repeatables in Redis.
      await this.queue.upsertJobScheduler(
        AUTH_CLEANUP_SCHEDULER_ID,
        { every: CLEANUP_EVERY_MS },
        {
          name: AUTH_CLEANUP_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
      this.logger.log(
        `Registered auth cleanup sweep (every ${CLEANUP_EVERY_MS}ms)`,
      );
    } catch (error) {
      // Boot must never hard-require Redis; a missed sweep is not urgent.
      this.logger.warn(
        `Auth cleanup registration skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Consumes the sweep. Split from the scheduler so each has one job. */
@Processor(AUTH_CLEANUP_QUEUE)
export class AuthCleanupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AuthCleanupProcessor.name);

  onModuleInit(): void {
    haltWorkerIfApiOnly(this.worker, (m) => this.logger.log(m));
  }

  constructor(
    private readonly sessions: SessionRepository,
    private readonly resetCodes: PasswordResetRepository,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AUTH_CLEANUP_JOB) return;
    const cutoff = new Date(
      Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const sessions = await this.sessions.deleteTerminalBefore(cutoff);
    const codes = await this.resetCodes.deleteExpired();
    this.logger.log(
      `Auth cleanup: removed ${sessions} session(s) and ${codes} reset code(s)`,
    );
  }
}
