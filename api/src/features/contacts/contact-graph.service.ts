import { Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  ContactInteractionRow,
  ContactRelationshipRow,
} from '../../infrastructure/database/schema/contact.schema';
import { ActivityService } from '../shared/activity.service';
import { ContactGraphRepository } from './contact-graph.repository';
import { ContactRepository } from './contact.repository';
import { ContactService } from './contact.service';
import type {
  CreateInteractionDto,
  CreateRelationshipDto,
} from './dto/graph.dto';

/** An edge as the caller sees it, always oriented away from the contact asked about. */
export interface PublicRelationship {
  id: string;
  otherContactId: string;
  type: ContactRelationshipRow['type'];
  direction: 'outgoing' | 'incoming';
  strength: ContactRelationshipRow['strength'];
  since: string | null;
  note: string | null;
}

@Injectable()
export class ContactGraphService {
  private readonly logger = new Logger(ContactGraphService.name);

  constructor(
    private readonly repo: ContactGraphRepository,
    private readonly contacts: ContactService,
    private readonly contactRepo: ContactRepository,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  // --- relationships ---

  /**
   * Edges touching a contact, re-oriented so the caller never has to know which
   * way round the row was stored.
   */
  async relationships(
    contactId: string,
    principal: Principal,
  ): Promise<PublicRelationship[]> {
    await this.assertReadable(contactId, principal);
    const rows = await this.repo.relationshipsFor(contactId);
    return rows.map((r) => ({
      id: r.id,
      otherContactId:
        r.fromContactId === contactId ? r.toContactId : r.fromContactId,
      type: r.type,
      direction: r.fromContactId === contactId ? 'outgoing' : 'incoming',
      strength: r.strength,
      since: r.since ?? null,
      note: r.note ?? null,
    }));
  }

  async addRelationship(
    contactId: string,
    dto: CreateRelationshipDto,
    principal: Principal,
  ): Promise<ContactRelationshipRow> {
    // Both ends must be visible: an edge to a contact the caller cannot see
    // would leak its existence through the other end's timeline.
    await this.assertReadable(contactId, principal);
    await this.assertReadable(dto.toContactId, principal);
    if (contactId === dto.toContactId) {
      throw this.errors.validation([
        { path: 'toContactId', message: 'A contact cannot relate to itself' },
      ]);
    }
    const existing = await this.repo.findRelationship(
      contactId,
      dto.toContactId,
      dto.type,
    );
    if (existing) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'That relationship already exists',
      });
    }
    const row = await this.repo.createRelationship({
      fromContactId: contactId,
      toContactId: dto.toContactId,
      type: dto.type,
      strength: dto.strength,
      since: dto.since ? dto.since.toISOString().slice(0, 10) : null,
      note: dto.note,
      createdBy: userIdOrNull(principal),
    });
    await this.activity.recordSafe({
      principal,
      entityType: 'contact',
      entityId: contactId,
      action: 'contact.relationship_added',
      summary: dto.type,
    });
    return row;
  }

  async removeRelationship(
    contactId: string,
    relationshipId: string,
    principal: Principal,
  ): Promise<void> {
    await this.assertReadable(contactId, principal);
    const removed = await this.repo.removeRelationship(relationshipId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  // --- interactions ---

  async listInteractions(
    contactId: string,
    page: number,
    limit: number,
    principal: Principal,
  ) {
    await this.assertReadable(contactId, principal);
    const { rows, total } = await this.repo.listInteractions(
      contactId,
      page,
      limit,
    );
    return { data: rows, total, page, limit };
  }

  async addInteraction(
    contactId: string,
    dto: CreateInteractionDto,
    principal: Principal,
  ): Promise<ContactInteractionRow> {
    await this.assertReadable(contactId, principal);
    const occurredAt = dto.occurredAt ?? new Date();
    const row = await this.repo.createInteraction({
      ...dto,
      contactId,
      occurredAt,
      userId: userIdOrNull(principal),
    });
    // The list view sorts by this; leaving it stale makes a busy contact look
    // untouched.
    await this.contactRepo.touchLastContacted(contactId, occurredAt);
    await this.activity.recordSafe({
      principal,
      entityType: 'contact',
      entityId: contactId,
      action: 'contact.interaction_logged',
      summary: dto.subject ?? dto.kind,
    });
    return row;
  }

  /**
   * Turn a stored inbound message into a timeline entry.
   *
   * Idempotent by construction: the partial unique index over
   * `email_message_id` means a mailbox re-sync cannot create a second entry, so
   * this can be called for every message without checking first (which would
   * race two sync workers anyway).
   *
   * Returns null when the entry already existed.
   */
  async recordInboundEmail(input: {
    contactId: string;
    emailMessageId: string;
    subject: string;
    snippet: string;
    receivedAt: Date;
  }): Promise<ContactInteractionRow | null> {
    const row = await this.repo.upsertEmailInteraction({
      contactId: input.contactId,
      emailMessageId: input.emailMessageId,
      kind: 'email_in',
      direction: 'inbound',
      occurredAt: input.receivedAt,
      subject: input.subject.slice(0, 500),
      body: input.snippet,
      userId: null,
    });
    if (row) {
      await this.contactRepo.touchLastContacted(
        input.contactId,
        input.receivedAt,
      );
    }
    return row;
  }

  async removeInteraction(
    contactId: string,
    interactionId: string,
    principal: Principal,
  ): Promise<void> {
    await this.assertReadable(contactId, principal);
    const removed = await this.repo.removeInteraction(interactionId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  private async assertReadable(
    contactId: string,
    principal: Principal,
  ): Promise<void> {
    if (!(await this.contacts.canRead(contactId, principal))) {
      throw this.errors.create(ErrorCode.NOT_FOUND);
    }
  }
}
