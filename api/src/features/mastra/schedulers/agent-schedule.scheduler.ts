import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MastraConfig } from '../../../config/configurations/mastra.config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AGENT_RUN_QUEUE,
  EXPIRE_APPROVALS_JOB,
  EXPIRE_APPROVALS_SCHEDULER_ID,
} from '../mastra.constants';
import { ScheduleService } from '../services/schedule.service';
import { workersEnabled } from '../../../infrastructure/queue/worker-role';

/** How often lapsed approvals are relabelled. */
const APPROVAL_EXPIRY_EVERY_MS = 15 * 60 * 1000;

/**
 * Bootstrap hook (NOT auto-run at import — mirrors `SearchReconciliationScheduler`,
 * which exposes an explicit method invoked from an ops/bootstrap hook rather than
 * scheduling itself in the constructor). Re-registers all enabled agent schedules'
 * repeatable BullMQ jobs once on application startup, so a Redis/queue restart
 * doesn't silently drop previously-registered repeatables.
 */
@Injectable()
export class AgentScheduleScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentScheduleScheduler.name);
  constructor(
    private readonly schedules: ScheduleService,
    private readonly config: ConfigService,
    @InjectQueue(AGENT_RUN_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // API-only replicas serve HTTP and leave the queues alone.
    if (!workersEnabled()) return;
    // Approval expiry is independent of MASTRA_SCHEDULES_ENABLED: it is
    // housekeeping for the chat flow, not a scheduled agent run.
    try {
      await this.queue.upsertJobScheduler(
        EXPIRE_APPROVALS_SCHEDULER_ID,
        { every: APPROVAL_EXPIRY_EVERY_MS },
        {
          name: EXPIRE_APPROVALS_JOB,
          data: {},
          opts: { removeOnComplete: true, removeOnFail: true },
        },
      );
    } catch (err) {
      this.logger.warn(
        `Approval expiry registration skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const cfg = this.config.getOrThrow<MastraConfig>('mastra');
    if (!cfg.schedulesEnabled) {
      this.logger.log(
        'Agent schedules disabled (MASTRA_SCHEDULES_ENABLED=false)',
      );
      return;
    }
    try {
      await this.schedules.syncRepeatableJobs();
      this.logger.log('Registered agent repeatable jobs');
    } catch (err) {
      this.logger.warn(
        `Schedule sync skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
