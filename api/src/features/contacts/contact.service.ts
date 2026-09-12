import { Injectable, Logger } from '@nestjs/common';
import { isAdmin, userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  ContactChannelRow,
  ContactRow,
} from '../../infrastructure/database/schema/contact.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import { TagService } from '../shared/tag.service';
import {
  ContactRepository,
  normalizeEmail,
  type ContactQuery,
} from './contact.repository';
import {
  canManageContact,
  canReadContact,
  resolveContactAccess,
} from './contact-scope.resolver';
import type {
  AddChannelDto,
  CreateContactDto,
  UpdateContactDto,
} from './dto/contact.dto';

export interface PublicContact {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  typeId: string | null;
  categoryId: string | null;
  ownerUserId: string | null;
  status: ContactRow['status'];
  source: ContactRow['source'];
  visibility: ContactRow['visibility'];
  country: string | null;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  tagIds: string[];
  createdAt: Date;
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly repo: ContactRepository,
    private readonly tags: TagService,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: ContactRow, tagIds: string[] = []): PublicContact {
    return {
      id: row.id,
      displayName: row.displayName,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
      primaryEmail: row.primaryEmail ?? null,
      primaryPhone: row.primaryPhone ?? null,
      jobTitle: row.jobTitle ?? null,
      companyId: row.companyId ?? null,
      typeId: row.typeId ?? null,
      categoryId: row.categoryId ?? null,
      ownerUserId: row.ownerUserId ?? null,
      status: row.status,
      source: row.source,
      visibility: row.visibility,
      country: row.country ?? null,
      lastContactedAt: row.lastContactedAt ?? null,
      nextFollowUpAt: row.nextFollowUpAt ?? null,
      tagIds,
      createdAt: row.createdAt,
    };
  }

  /** A contact always has something to render, whatever the caller supplied. */
  private deriveDisplayName(input: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    primaryEmail?: string;
  }): string {
    if (input.displayName?.trim()) return input.displayName.trim();
    const name = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) return name;
    return input.primaryEmail ?? 'Unnamed contact';
  }

  async create(
    dto: CreateContactDto,
    principal: Principal,
  ): Promise<PublicContact> {
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'contact');
    }
    const { tagIds, ...rest } = dto;
    const row = await this.repo.upsertByEmail({
      ...rest,
      birthday: dto.birthday ? dto.birthday.toISOString().slice(0, 10) : null,
      displayName: this.deriveDisplayName(dto),
      ownerUserId: userIdOrNull(principal),
      address: dto.address ?? {},
    });
    if (tagIds?.length) {
      await this.repo.setTags(row.id, tagIds, userIdOrNull(principal));
    }
    await this.activity.recordSafe({
      principal,
      entityType: 'contact',
      entityId: row.id,
      action: 'contact.created',
      summary: row.displayName,
    });
    return this.toPublic(row, tagIds ?? []);
  }

  /**
   * Create or update by email — the ingest path.
   *
   * Callers that meet addresses they did not choose (inbound mail, an import, an
   * agent) must use this. A plain insert would fail the dedup index on valid
   * data, and "contact already exists" is the normal case here, not an error.
   */
  async ingestByEmail(input: {
    email: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
    companyId?: string;
    source: ContactRow['source'];
  }): Promise<ContactRow> {
    return this.repo.upsertByEmail({
      primaryEmail: input.email,
      displayName: this.deriveDisplayName({
        displayName: input.displayName,
        firstName: input.firstName,
        lastName: input.lastName,
        primaryEmail: input.email,
      }),
      firstName: input.firstName,
      lastName: input.lastName,
      companyId: input.companyId,
      source: input.source,
      // No owner: a pipeline runs under a `system`/`service` principal, which
      // has no `users.id` to write here.
      ownerUserId: null,
    });
  }

  async list(q: ContactQuery, principal: Principal) {
    // Non-admins see their own plus explicitly shared rows. Applied as a SQL
    // predicate so the page and its total agree.
    const scoped: ContactQuery = {
      ...q,
      visibleTo:
        isAdmin(principal) || principal.kind === 'system'
          ? undefined
          : principal.kind === 'user'
            ? principal.userId
            : // A service credential owns nothing; give it shared rows only.
              '00000000-0000-0000-0000-000000000000',
    };
    const { rows, total } = await this.repo.list(scoped);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async get(id: string, principal: Principal): Promise<PublicContact> {
    const row = await this.requireReadable(id, principal);
    const tagIds = await this.repo.tagIdsFor(id);
    return this.toPublic(row, tagIds);
  }

  async update(
    id: string,
    dto: UpdateContactDto,
    principal: Principal,
  ): Promise<PublicContact> {
    const existing = await this.requireManageable(id, principal);
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'contact');
    }
    const { tagIds, ...rest } = dto;

    // Changing the email moves the dedup key with it, or the row would keep
    // matching its old address on the next ingest.
    const patch: Record<string, unknown> = { ...rest };
    if (dto.primaryEmail !== undefined) {
      patch.emailNormalized = normalizeEmail(dto.primaryEmail);
    }
    if (dto.birthday !== undefined) {
      patch.birthday = dto.birthday
        ? dto.birthday.toISOString().slice(0, 10)
        : null;
    }

    const row = await this.repo.update(id, patch);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (tagIds) {
      await this.repo.setTags(id, tagIds, userIdOrNull(principal));
    }
    await this.activity.recordSafe({
      principal,
      entityType: 'contact',
      entityId: id,
      action: 'contact.updated',
      changes: this.diff(existing, rest),
    });
    return this.toPublic(row, tagIds ?? (await this.repo.tagIdsFor(id)));
  }

  async remove(id: string, principal: Principal): Promise<void> {
    await this.requireManageable(id, principal);
    await this.repo.softDelete(id);
    // The polymorphic tables carry no foreign key, so nothing in the database
    // removes their rows when this one goes.
    await this.cascade.purgeFor('contact', id);
    await this.activity.recordSafe({
      principal,
      entityType: 'contact',
      entityId: id,
      action: 'contact.deleted',
    });
  }

  // --- channels ---

  async listChannels(id: string, principal: Principal) {
    await this.requireReadable(id, principal);
    return this.repo.listChannels(id);
  }

  async addChannel(
    id: string,
    dto: AddChannelDto,
    principal: Principal,
  ): Promise<ContactChannelRow> {
    await this.requireManageable(id, principal);
    if (dto.isPrimary) {
      // At most one primary per (contact, kind); the partial unique index would
      // otherwise reject the insert.
      await this.repo.clearPrimary(id, dto.kind);
    }
    return this.repo.addChannel({ ...dto, contactId: id });
  }

  async removeChannel(
    id: string,
    channelId: string,
    principal: Principal,
  ): Promise<void> {
    await this.requireManageable(id, principal);
    const removed = await this.repo.removeChannel(channelId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  // --- access ---

  /** Whether a principal may read a contact — the registry's resolver. */
  async canRead(id: string, principal: Principal): Promise<boolean> {
    const row = await this.repo.findLiveById(id);
    if (!row) return false;
    return canReadContact(resolveContactAccess(row, principal));
  }

  private async requireReadable(
    id: string,
    principal: Principal,
  ): Promise<ContactRow> {
    const row = await this.repo.findLiveById(id);
    // NOT_FOUND rather than FORBIDDEN throughout: confirming that a contact
    // exists is itself a disclosure about who the business deals with.
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (!canReadContact(resolveContactAccess(row, principal))) {
      throw this.errors.create(ErrorCode.NOT_FOUND);
    }
    return row;
  }

  private async requireManageable(
    id: string,
    principal: Principal,
  ): Promise<ContactRow> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    const access = resolveContactAccess(row, principal);
    if (!canReadContact(access)) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (!canManageContact(access)) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Only the contact owner or an admin can change it',
      });
    }
    return row;
  }

  /** Field-level before/after for the activity feed. Business fields only. */
  private diff(
    before: ContactRow,
    patch: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, to] of Object.entries(patch)) {
      const from = (before as unknown as Record<string, unknown>)[key];
      if (from !== to) changes[key] = { from, to };
    }
    return changes;
  }
}
