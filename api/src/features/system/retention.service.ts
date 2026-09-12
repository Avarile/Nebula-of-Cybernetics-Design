import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { DataRetentionPolicyRow } from '../../infrastructure/database/schema/system.schema';
import { RetentionRepository } from './retention.repository';
import { RetentionPurgeRegistry } from '../../infrastructure/retention/retention.registry';
import {
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES_PER_RUN,
} from './system.constants';

export interface RetentionRunResult {
  entityType: DataRetentionPolicyRow['entityType'];
  deleted: number;
  status: 'ok' | 'partial' | 'skipped' | 'failed';
  detail?: string;
}

export interface PublicRetentionPolicy {
  entityType: DataRetentionPolicyRow['entityType'];
  retentionDays: number;
  action: DataRetentionPolicyRow['action'];
  enabled: boolean;
  hasPurgeHandler: boolean;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastDeletedCount: number | null;
  description: string | null;
}

/**
 * Applies `data_retention_policies`.
 *
 * Declarative on purpose: retention used to be implicit and per-feature, so
 * adding a rule meant writing another scheduler. Here it is a row, and this
 * service is the only thing that acts on one.
 *
 * Two policies ship disabled — `email_messages` (the mailbox archive) and
 * `search_records` (the source of truth behind the search index). Purging
 * either destroys content rather than trimming a log, so they are seeded at the
 * agreed window but left off until someone enables them knowingly.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly repo: RetentionRepository,
    private readonly registry: RetentionPurgeRegistry,
    private readonly errors: ExceptionService,
  ) {}

  async list(): Promise<PublicRetentionPolicy[]> {
    const rows = await this.repo.listAll();
    return rows.map((r) => ({
      entityType: r.entityType,
      retentionDays: r.retentionDays,
      action: r.action,
      enabled: r.enabled,
      // Surfaced so an operator can see that an enabled policy has nothing
      // behind it yet, rather than assuming it is running.
      hasPurgeHandler: this.registry.get(r.entityType) !== undefined,
      lastRunAt: r.lastRunAt ?? null,
      lastRunStatus: r.lastRunStatus ?? null,
      lastDeletedCount: r.lastDeletedCount ?? null,
      description: r.description ?? null,
    }));
  }

  async setEnabled(
    entityType: DataRetentionPolicyRow['entityType'],
    enabled: boolean,
  ): Promise<PublicRetentionPolicy> {
    const row = await this.repo.setEnabled(entityType, enabled);
    if (!row) throw this.errors.create(ErrorCode.RETENTION_POLICY_NOT_FOUND);
    this.logger.warn(
      `Retention policy for "${entityType}" ${enabled ? 'ENABLED' : 'disabled'}`,
    );
    return (await this.list()).find((p) => p.entityType === entityType)!;
  }

  async setRetentionDays(
    entityType: DataRetentionPolicyRow['entityType'],
    days: number,
  ): Promise<PublicRetentionPolicy> {
    const row = await this.repo.setRetentionDays(entityType, days);
    if (!row) throw this.errors.create(ErrorCode.RETENTION_POLICY_NOT_FOUND);
    return (await this.list()).find((p) => p.entityType === entityType)!;
  }

  /** Run every enabled policy. Called by the sweep; safe to call by hand. */
  async runAll(): Promise<RetentionRunResult[]> {
    const policies = await this.repo.listEnabled();
    const results: RetentionRunResult[] = [];
    for (const policy of policies) {
      results.push(await this.runOne(policy));
    }
    return results;
  }

  /**
   * Purge one policy in bounded batches.
   *
   * Stops after `RETENTION_MAX_BATCHES_PER_RUN` and reports `partial` rather
   * than looping until the table is clean: a first run against a long-neglected
   * table would otherwise delete millions of rows in one transaction-heavy
   * burst. The next tick picks up where this one stopped.
   */
  private async runOne(
    policy: DataRetentionPolicyRow,
  ): Promise<RetentionRunResult> {
    const purge = this.registry.get(policy.entityType);
    if (!purge) {
      // Never silently "succeed": an enabled policy with no handler means the
      // table is growing unattended, and only a warning will reveal it.
      this.logger.warn(
        `Retention policy "${policy.entityType}" is enabled but no purge is registered — skipping`,
      );
      await this.repo.recordRun(policy.id, 'skipped:no-handler', 0);
      return { entityType: policy.entityType, deleted: 0, status: 'skipped' };
    }

    const cutoff = new Date(
      Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000,
    );
    let deleted = 0;
    let batches = 0;
    try {
      for (; batches < RETENTION_MAX_BATCHES_PER_RUN; batches++) {
        const removed = await purge(cutoff, RETENTION_BATCH_SIZE);
        deleted += removed;
        if (removed < RETENTION_BATCH_SIZE) break;
      }
      const partial = batches >= RETENTION_MAX_BATCHES_PER_RUN;
      const status = partial ? 'partial' : 'ok';
      await this.repo.recordRun(policy.id, status, deleted);
      if (deleted > 0) {
        this.logger.log(
          `Retention "${policy.entityType}": deleted ${deleted} row(s) older than ` +
            `${policy.retentionDays}d${partial ? ' (batch limit reached)' : ''}`,
        );
      }
      return { entityType: policy.entityType, deleted, status };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Retention "${policy.entityType}" failed: ${detail}`);
      await this.repo.recordRun(policy.id, 'failed', deleted);
      return {
        entityType: policy.entityType,
        deleted,
        status: 'failed',
        detail,
      };
    }
  }
}
