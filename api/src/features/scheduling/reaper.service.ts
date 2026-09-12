import { Injectable, Logger } from '@nestjs/common';
import { SchedulingRepository, type ReapResult } from './scheduling.repository';

/**
 * Returns abandoned claims to the queue.
 *
 * This is the whole crash-recovery story. When a process dies mid-handler its
 * row stays `claimed` with a lease that stops ticking; a minute later this
 * returns it to `pending` and it runs again. Nothing has to be cleaned up by
 * the process that crashed — the only kind of cleanup that can be relied on.
 *
 * Jobs with no attempts left are dead-lettered instead of re-queued, which is
 * what closes the poison-job loop: a handler that kills the worker every time
 * would otherwise be resurrected here forever.
 */
@Injectable()
export class ReaperService {
  private readonly logger = new Logger(ReaperService.name);

  constructor(private readonly jobs: SchedulingRepository) {}

  async run(): Promise<ReapResult> {
    const result = await this.jobs.reapExpiredLeases();
    if (result.requeued > 0 || result.deadLettered > 0) {
      this.logger.warn(
        `Reaper: requeued ${result.requeued} expired lease(s)` +
          (result.deadLettered > 0
            ? `, dead-lettered ${result.deadLettered} with no attempts left`
            : ''),
      );
    }
    return result;
  }
}
