import { Injectable, Logger } from '@nestjs/common';
import type { SystemEventLogRow } from '../../infrastructure/database/schema/system.schema';
import {
  SystemEventRepository,
  type SystemEventQuery,
} from './system-event.repository';

export interface SystemEventInput {
  severity?: SystemEventLogRow['severity'];
  /** Emitting component, e.g. `search-indexing.processor`. */
  source: string;
  /** Stable machine key, e.g. `search.reconcile.completed`. */
  eventKey: string;
  message: string;
  payload?: Record<string, unknown>;
  entityType?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
}

/** Payload keys that must never be persisted, whatever an emitter passes. */
const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'secret',
  'secretenc',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'keyhash',
  'codehash',
  'authorization',
  'cookie',
];

/**
 * Structured operational events an operator queries and joins to business rows:
 * sweep outcomes, integration failures, quota breaches, retention purges.
 *
 * Application logs deliberately do NOT come here. Request logs, stack traces and
 * debug output belong in stdout and the log shipper, where they are cheap and
 * rotated; in Postgres they cost write throughput, disk and vacuum pressure for
 * nothing. The rule for emitting is `severity >= warn`, or an event with a named
 * operator consumer.
 */
@Injectable()
export class SystemEventService {
  private readonly logger = new Logger(SystemEventService.name);

  constructor(private readonly repo: SystemEventRepository) {}

  /**
   * Record an event. Never throws.
   *
   * An observability write must not be able to fail the operation it observes —
   * a sweep that completed successfully should not be reported as failed
   * because its completion event could not be inserted.
   */
  async emit(input: SystemEventInput): Promise<void> {
    try {
      await this.repo.append({
        severity: input.severity ?? 'info',
        source: input.source,
        eventKey: input.eventKey,
        message: input.message.slice(0, 1000),
        payload: this.redact(input.payload ?? {}),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        correlationId: input.correlationId ?? null,
        durationMs: input.durationMs ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `Event "${input.eventKey}" not persisted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  warn(input: Omit<SystemEventInput, 'severity'>): Promise<void> {
    return this.emit({ ...input, severity: 'warn' });
  }

  error(input: Omit<SystemEventInput, 'severity'>): Promise<void> {
    return this.emit({ ...input, severity: 'error' });
  }

  async list(q: SystemEventQuery) {
    const { rows, total } = await this.repo.list(q);
    return { data: rows, total, page: q.page, limit: q.limit };
  }

  /**
   * Strip secret-looking keys from a payload, one level deep.
   *
   * `system_audit_log` solves this by storing field NAMES only. This table
   * stores values because an operator needs them, so the guard moves here: an
   * emitter that passes a whole config object should not be able to write a
   * decrypted secret into a table with a 120-day retention and an admin read
   * endpoint.
   */
  private redact(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
      if (REDACTED_KEYS.includes(normalized)) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? this.redact(value as Record<string, unknown>)
          : value;
    }
    return out;
  }
}
