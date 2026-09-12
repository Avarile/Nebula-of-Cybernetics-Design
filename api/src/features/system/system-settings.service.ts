import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SystemConfig } from '../../config/configurations/system.config';
import type { Cache } from 'cache-manager';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  SettingValue,
  SystemSettingRow,
} from '../../infrastructure/database/schema/system.schema';
import type { UpsertSettingDto } from './dto/upsert-setting.dto';
import { SystemSettingsRepository } from './system-settings.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicSetting {
  key: string;
  value: SettingValue;
  type: SystemSettingRow['type'];
  category: string;
  description: string | null;
  updatedAt: Date;
  /** Pass back as `expectedVersion` to make the next write conflict-checked. */
  version: number;
}

@Injectable()
export class SystemSettingsService {
  /** Cache lifetime for a setting. Every other comparable knob is env-driven. */
  private readonly ttlMs: number;

  constructor(
    private readonly repo: SystemSettingsRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly audit: SystemAuditService,
    private readonly errors: ExceptionService,
    config: ConfigService,
  ) {
    this.ttlMs = config.getOrThrow<SystemConfig>('system').settingsCacheTtlMs;
  }

  private cacheKey(key: string): string {
    return `system:setting:${key}`;
  }

  private toPublic(row: SystemSettingRow): PublicSetting {
    return {
      key: row.key,
      value: row.valueJson,
      type: row.type,
      category: row.category,
      description: row.description ?? null,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  }

  /** Cache-through read; undefined if the key does not exist. */
  private async read(key: string): Promise<PublicSetting | undefined> {
    const cached = await this.cache.get<PublicSetting>(this.cacheKey(key));
    if (cached) return cached;
    const row = await this.repo.findByKey(key);
    if (!row) return undefined;
    const pub = this.toPublic(row);
    await this.cache.set(this.cacheKey(key), pub, this.ttlMs);
    return pub;
  }

  async get(key: string): Promise<PublicSetting> {
    const pub = await this.read(key);
    if (!pub)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: `Setting "${key}" not found`,
      });
    return pub;
  }

  async list(q: { category?: string; page: number; limit: number }) {
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async upsert(
    key: string,
    dto: UpsertSettingDto,
    ctx: AuditContext,
  ): Promise<PublicSetting> {
    // Optimistic concurrency. Two admins editing one setting used to overwrite
    // each other with no trace beyond the audit line; a caller that read the
    // row first can now be told its edit was based on a stale value.
    if (dto.expectedVersion !== undefined) {
      const current = await this.repo.findByKey(key);
      if (current && current.version !== dto.expectedVersion) {
        throw this.errors.create(ErrorCode.SETTING_VERSION_CONFLICT, {
          message:
            `Setting "${key}" is at version ${current.version}, ` +
            `not ${dto.expectedVersion}`,
        });
      }
    }
    const row = await this.repo.upsertByKey(
      key,
      {
        valueJson: dto.value as SettingValue,
        type: dto.type,
        category: dto.category,
        description: dto.description,
      },
      { changedBy: ctx.actorId },
    );
    await this.cache.del(this.cacheKey(key));
    await this.audit.record({
      ctx,
      action: 'setting.update',
      entityType: 'setting',
      entityId: row.id,
      metadata: { key, type: dto.type, category: dto.category },
    });
    return this.toPublic(row);
  }

  async remove(key: string, ctx: AuditContext): Promise<void> {
    const deleted = await this.repo.softDelete(key);
    if (!deleted)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: `Setting "${key}" not found`,
      });
    await this.cache.del(this.cacheKey(key));
    await this.audit.record({
      ctx,
      action: 'setting.delete',
      entityType: 'setting',
      metadata: { key },
    });
  }

  /** Value history for one setting, newest first. */
  async revisions(key: string, limit = 50) {
    return this.repo.listRevisions(key, limit);
  }

  // --- Typed getters for internal consumers (return default when missing) ---

  async getString(key: string, def?: string): Promise<string | undefined> {
    const pub = await this.read(key);
    return typeof pub?.value === 'string' ? pub.value : def;
  }

  async getNumber(key: string, def?: number): Promise<number | undefined> {
    const pub = await this.read(key);
    return typeof pub?.value === 'number' ? pub.value : def;
  }

  async getBoolean(key: string, def?: boolean): Promise<boolean | undefined> {
    const pub = await this.read(key);
    return typeof pub?.value === 'boolean' ? pub.value : def;
  }

  async getJson<T>(key: string, def?: T): Promise<T | undefined> {
    const pub = await this.read(key);
    return pub && typeof pub.value === 'object' ? (pub.value as T) : def;
  }
}
