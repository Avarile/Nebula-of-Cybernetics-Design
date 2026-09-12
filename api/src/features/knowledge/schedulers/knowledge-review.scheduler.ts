import { Injectable, Logger } from '@nestjs/common';
import { SystemEventService } from '../../system/system-event.service';
import { KnowledgeRepository } from '../knowledge.repository';

/** Ceiling on how many overdue records one sweep reports. */
const REVIEW_BATCH = 200;

/**
 * Finds published records whose review has fallen due.
 *
 * Stale knowledge is worse than none: a runbook nobody has re-read in two years
 * still reads as authoritative. The sweep records a system event today; once the
 * notification pipeline exists it enqueues `knowledge.review_due` to each
 * owner, which is why the query returns owners rather than a bare count.
 *
 * Not self-registering on the queue: it is driven by the retention/ops sweep
 * cadence rather than its own repeatable job, so there is one fewer scheduler
 * to keep alive for something that is not time-critical.
 */
@Injectable()
export class KnowledgeReviewScheduler {
  private readonly logger = new Logger(KnowledgeReviewScheduler.name);

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly events: SystemEventService,
  ) {}

  /** Returns the overdue records, newest deadline first. */
  async findOverdue(now = new Date()) {
    const rows = await this.repo.dueForReview(now, REVIEW_BATCH);
    if (rows.length > 0) {
      await this.events.warn({
        source: 'knowledge-review.scheduler',
        eventKey: 'knowledge.review_due',
        message: `${rows.length} published record(s) are due for review`,
        payload: {
          knowledgeIds: rows.map((r) => r.id),
          truncated: rows.length === REVIEW_BATCH,
        },
      });
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      ownerUserId: r.ownerUserId,
      reviewDueAt: r.reviewDueAt,
    }));
  }
}
