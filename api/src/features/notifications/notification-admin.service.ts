import { Injectable, Logger } from '@nestjs/common';
import { requireUserId, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { NotificationSuppressionRow } from '../../infrastructure/database/schema/notification.schema';
import { NotificationRepository } from './notification.repository';
import type {
  SetNotificationPreferenceDto,
  SuppressDto,
  UpsertTemplateDto,
} from './dto/notification.dto';
import { placeholdersIn } from './template-renderer';

/**
 * The catalog, templates, preferences and suppression list.
 *
 * Split from `NotificationService` (which only enqueues) because these are
 * administrative reads and writes with different access rules — and because the
 * enqueue path is on the request path of every other module and should stay
 * narrow.
 */
@Injectable()
export class NotificationAdminService {
  private readonly logger = new Logger(NotificationAdminService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly errors: ExceptionService,
  ) {}

  listEventTypes() {
    return this.repo.listEventTypes();
  }

  listTemplates() {
    return this.repo.listTemplates();
  }

  /**
   * Create or update a template.
   *
   * Placeholders in the body that are not declared in `variables` are rejected:
   * an undeclared placeholder renders as an empty gap in a customer's inbox,
   * and this is the last point at which anyone will notice.
   */
  async upsertTemplate(key: string, dto: UpsertTemplateDto) {
    const declared = new Set(Object.keys(dto.variables));
    const used = new Set([
      ...placeholdersIn(dto.subjectTemplate),
      ...placeholdersIn(dto.bodyTextTemplate),
      ...placeholdersIn(dto.bodyHtmlTemplate ?? ''),
    ]);
    const undeclared = [...used].filter((name) => !declared.has(name));
    if (undeclared.length > 0) {
      throw this.errors.validation(
        undeclared.map((name) => ({
          path: 'variables',
          message: `Template uses "${name}" but does not declare it`,
        })),
      );
    }
    return this.repo.upsertTemplate(key, dto.locale, dto);
  }

  // --- preferences ---

  async listPreferences(principal: Principal) {
    const userId = requireUserId(principal);
    const [rows, eventTypes] = await Promise.all([
      this.repo.listPreferences(userId),
      this.repo.listEventTypes(),
    ]);
    const byEventTypeId = new Map(rows.map((r) => [r.eventTypeId, r]));
    // Every event, with the effective setting — a client should not have to
    // reimplement "absent means the event's default".
    return eventTypes.map((event) => {
      const preference = byEventTypeId.get(event.id);
      return {
        eventKey: event.key,
        name: event.name,
        category: event.category,
        isMandatory: event.isMandatory,
        enabled: event.isMandatory
          ? true
          : (preference?.enabled ?? event.defaultEnabled),
        frequency: preference?.frequency ?? 'immediate',
        quietHoursStart: preference?.quietHoursStart ?? null,
        quietHoursEnd: preference?.quietHoursEnd ?? null,
      };
    });
  }

  async setPreference(principal: Principal, dto: SetNotificationPreferenceDto) {
    const userId = requireUserId(principal);
    const eventType = await this.repo.findEventType(dto.eventKey);
    if (!eventType) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Unknown notification event "${dto.eventKey}"`,
      });
    }
    if (eventType.isMandatory && !dto.enabled) {
      // Security and transactional mail is not opt-outable; without this a user
      // could silently disable their own password-reset delivery.
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `"${eventType.key}" is a required notification and cannot be disabled`,
      });
    }
    return this.repo.upsertPreference(userId, eventType.id, {
      enabled: dto.enabled,
      frequency: dto.frequency,
      quietHoursStart: dto.quietHoursStart,
      quietHoursEnd: dto.quietHoursEnd,
    });
  }

  // --- suppressions ---

  listSuppressions(page: number, limit: number) {
    return this.repo.listSuppressions(page, limit);
  }

  async suppress(dto: SuppressDto): Promise<void> {
    const eventType = dto.eventKey
      ? await this.repo.findEventType(dto.eventKey)
      : null;
    if (dto.eventKey && !eventType) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Unknown notification event "${dto.eventKey}"`,
      });
    }
    await this.repo.suppress(
      dto.email,
      dto.reason,
      eventType?.id ?? null,
      'admin',
      dto.expiresAt ?? null,
    );
    this.logger.warn(`Suppressed ${dto.email} (${dto.reason})`);
  }

  async unsuppress(email: string): Promise<void> {
    const removed = await this.repo.unsuppress(email);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
    this.logger.warn(`Un-suppressed ${email}`);
  }

  /**
   * Record a bounce reported by the relay.
   *
   * A hard bounce never expires; a repeated soft bounce is suppressed for a
   * week, because the address may come back.
   */
  async recordBounce(
    email: string,
    kind: 'hard' | 'soft' | 'complaint',
  ): Promise<void> {
    const reason: NotificationSuppressionRow['reason'] =
      kind === 'hard'
        ? 'hard_bounce'
        : kind === 'complaint'
          ? 'complaint'
          : 'soft_bounce_repeated';
    const expiresAt =
      kind === 'soft' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
    await this.repo.suppress(
      email,
      reason,
      null,
      'bounce-processor',
      expiresAt,
    );
  }
}
