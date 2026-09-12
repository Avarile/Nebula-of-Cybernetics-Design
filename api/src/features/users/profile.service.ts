import { Injectable } from '@nestjs/common';
import { requireUserId, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  UserPreferenceRow,
  UserProfileRow,
} from '../../infrastructure/database/schema/profile.schema';
import { SystemSettingsService } from '../system/system-settings.service';
import type { SetPreferenceDto, UpdateProfileDto } from './dto/profile.dto';
import { ProfileRepository } from './profile.repository';

export interface PublicProfile {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  avatarFileId: string | null;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  timezone: string;
  locale: string;
  dateFormat: string | null;
  timeFormat: string | null;
  bio: string | null;
  contactId: string | null;
}

/** A profile that has never been written, so a read always has a shape. */
const EMPTY_PROFILE = (userId: string): PublicProfile => ({
  userId,
  firstName: null,
  lastName: null,
  avatarFileId: null,
  jobTitle: null,
  department: null,
  phone: null,
  timezone: 'UTC',
  locale: 'en',
  dateFormat: null,
  timeFormat: null,
  bio: null,
  contactId: null,
});

@Injectable()
export class ProfileService {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly settings: SystemSettingsService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: UserProfileRow): PublicProfile {
    return {
      userId: row.userId,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
      avatarFileId: row.avatarFileId ?? null,
      jobTitle: row.jobTitle ?? null,
      department: row.department ?? null,
      phone: row.phone ?? null,
      timezone: row.timezone,
      locale: row.locale,
      dateFormat: row.dateFormat ?? null,
      timeFormat: row.timeFormat ?? null,
      bio: row.bio ?? null,
      contactId: row.contactId ?? null,
    };
  }

  /**
   * Read a profile. Absent rows read as defaults rather than 404 — the row is
   * created lazily, so "never edited" and "does not exist" are the same state
   * and callers should not have to tell them apart.
   */
  async get(userId: string): Promise<PublicProfile> {
    const row = await this.repo.findByUserId(userId);
    return row ? this.toPublic(row) : EMPTY_PROFILE(userId);
  }

  async getOwn(principal: Principal): Promise<PublicProfile> {
    return this.get(requireUserId(principal));
  }

  async updateOwn(
    principal: Principal,
    dto: UpdateProfileDto,
  ): Promise<PublicProfile> {
    const userId = requireUserId(principal);
    const row = await this.repo.upsert(userId, dto);
    return this.toPublic(row);
  }

  // --- preferences ---

  async listPreferences(principal: Principal) {
    const userId = requireUserId(principal);
    const rows = await this.repo.listPreferences(userId);
    return rows.map((r) => ({ key: r.key, value: r.valueJson, type: r.type }));
  }

  /**
   * Resolve one preference: the user's own value, then the system default, then
   * the caller's fallback. Callers get one answer instead of each re-deriving
   * the precedence.
   */
  async resolve<T>(
    userId: string,
    key: string,
    fallback: T,
  ): Promise<T | UserPreferenceRow['valueJson']> {
    const own = await this.repo.findPreference(userId, key);
    if (own) return own.valueJson;
    const systemDefault = await this.settings.get(key).catch(() => undefined);
    return systemDefault ? systemDefault.value : fallback;
  }

  async setPreference(
    principal: Principal,
    key: string,
    dto: SetPreferenceDto,
  ) {
    const userId = requireUserId(principal);
    const row = await this.repo.upsertPreference(
      userId,
      key,
      dto.value as UserPreferenceRow['valueJson'],
      dto.type,
    );
    return { key: row.key, value: row.valueJson, type: row.type };
  }

  async removePreference(principal: Principal, key: string): Promise<void> {
    const userId = requireUserId(principal);
    const removed = await this.repo.deletePreference(userId, key);
    if (!removed) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: `Preference "${key}" is not set`,
      });
    }
  }
}
