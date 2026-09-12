import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { DrizzleExecutor } from '../../infrastructure/database/drizzle.constants';
import type {
  ActivityLogRow,
  NewActivityLogRow,
} from '../../infrastructure/database/schema/shared.schema';
import { type Principal } from '../../common/principal';
import { RetentionPurgeRegistry } from '../../infrastructure/retention/retention.registry';
import { ActivityRepository, type ActivityQuery } from './activity.repository';

/** What a caller supplies; the actor columns are derived, never passed in. */
export interface ActivityInput {
  principal: Principal;
  entityType: ActivityLogRow['entityType'];
  entityId?: string | null;
  /** Dotted verb, e.g. `task.status_changed`. */
  action: string;
  summary?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** Denormalized scope key. Set it for anything beneath a project. */
  projectId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Activity row as exposed by the API. */
export interface PublicActivity {
  id: string;
  createdAt: Date;
  actorUserId: string | null;
  actorKind: ActivityLogRow['actorKind'];
  entityType: ActivityLogRow['entityType'];
  entityId: string | null;
  action: string;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  projectId: string | null;
}

/**
 * The ONLY writer of `activity_log`.
 *
 * Centralised because the actor columns cannot be derived correctly at each
 * call site: a `service` principal carries a `service_credentials.id`, which is
 * not a `users.id` and violates the foreign key if written to `actor_user_id`
 * (see `common/principal.ts`). Deriving that here, once, is what keeps
 * `actor_kind` honest — a feature writing the table directly should fail review.
 */
@Injectable()
export class ActivityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly repo: ActivityRepository,
    private readonly retention: RetentionPurgeRegistry,
  ) {}

  /**
   * Declare how `activity_log` is purged.
   *
   * Registered by the owner of the table rather than by the sweep, so the sweep
   * never needs to import the modules whose rows it deletes.
   */
  onApplicationBootstrap(): void {
    this.retention.register('activity_log', (cutoff, limit) =>
      this.repo.purgeOlderThan(cutoff, limit),
    );
  }

  /**
   * Append an activity row, optionally inside the caller's transaction.
   *
   * Errors propagate. That is deliberate for the transactional path: if the
   * history write fails, the change it describes should not commit either. Use
   * {@link recordSafe} where the activity is genuinely incidental.
   */
  async record(
    input: ActivityInput,
    executor?: DrizzleExecutor,
  ): Promise<ActivityLogRow> {
    return this.repo.append(this.toRow(input), executor);
  }

  /**
   * Fire-and-forget variant: logs and swallows.
   *
   * For paths outside a transaction where losing a feed entry is preferable to
   * failing the operation — a read-side view count, a best-effort audit of a
   * background sweep. Never use it inside a transaction: swallowing there hides
   * a rollback the caller needed to know about.
   */
  async recordSafe(input: ActivityInput): Promise<void> {
    try {
      await this.repo.append(this.toRow(input));
    } catch (error) {
      this.logger.warn(
        `Activity "${input.action}" not recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(q: ActivityQuery) {
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  /**
   * Bounded delete for the retention sweep, registered by `RetentionScheduler`.
   *
   * Exposed on the service rather than by exporting the repository: a module
   * boundary that leaks repositories loses the invariants the service holds.
   */
  async purgeOlderThan(cutoff: Date, limit: number): Promise<number> {
    return this.repo.purgeOlderThan(cutoff, limit);
  }

  /** Derives the actor columns from the principal union. */
  private toRow(input: ActivityInput): NewActivityLogRow {
    const actor = this.actorOf(input.principal);
    return {
      ...actor,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      summary: input.summary ?? null,
      changes: input.changes ?? {},
      projectId: input.projectId ?? null,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    };
  }

  /**
   * An anonymous principal has no arm in `actor_kind` — every route that
   * produces activity requires authentication, so this is unreachable rather
   * than merely unhandled. It is recorded as `system` instead of throwing:
   * losing the actor is bad, losing the event entirely is worse.
   */
  private actorOf(
    principal: Principal,
  ): Pick<
    NewActivityLogRow,
    'actorKind' | 'actorUserId' | 'actorCredentialId'
  > {
    switch (principal.kind) {
      case 'user':
        return {
          actorKind: 'user',
          actorUserId: principal.userId,
          actorCredentialId: null,
        };
      case 'service':
        return {
          actorKind: 'service',
          actorUserId: null,
          actorCredentialId: principal.credentialId,
        };
      case 'system':
      case 'anonymous':
      default:
        return {
          actorKind: 'system',
          actorUserId: null,
          actorCredentialId: null,
        };
    }
  }

  private toPublic(row: ActivityLogRow): PublicActivity {
    return {
      id: row.id,
      createdAt: row.createdAt,
      actorUserId: row.actorUserId,
      actorKind: row.actorKind,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      summary: row.summary,
      changes: row.changes,
      projectId: row.projectId,
    };
  }
}
