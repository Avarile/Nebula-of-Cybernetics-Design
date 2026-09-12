import { Injectable } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  KnowledgeAccessControlRow,
  KnowledgeContactLinkRow,
} from '../../infrastructure/database/schema/knowledge.schema';
import { ActivityService } from '../shared/activity.service';
import type { CreateGrantDto, LinkContactDto } from './dto/knowledge.dto';
import { KnowledgeAclRepository } from './knowledge-acl.repository';
import { KnowledgeProjectionService } from './knowledge-projection.service';
import { KnowledgeService } from './knowledge.service';

/**
 * Grants and contact links on a knowledge record.
 *
 * Every grant change reprojects the record: `aclUserIds` in the search index is
 * a denormalization of exactly these rows, and a grant that is not reprojected
 * is one the index keeps honouring.
 */
@Injectable()
export class KnowledgeAclService {
  constructor(
    private readonly repo: KnowledgeAclRepository,
    private readonly knowledge: KnowledgeService,
    private readonly projection: KnowledgeProjectionService,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  async listGrants(
    knowledgeId: string,
    principal: Principal,
  ): Promise<KnowledgeAccessControlRow[]> {
    // Seeing who else has access is itself a manage-level capability.
    await this.knowledge.require(knowledgeId, principal, 'manage');
    return this.repo.grantsFor(knowledgeId);
  }

  async grant(
    knowledgeId: string,
    dto: CreateGrantDto,
    principal: Principal,
  ): Promise<KnowledgeAccessControlRow> {
    await this.knowledge.require(knowledgeId, principal, 'manage');
    const row = await this.repo.createGrant({
      knowledgeId,
      granteeType: dto.granteeType,
      granteeUserId: dto.granteeUserId ?? null,
      granteeRoleId: dto.granteeRoleId ?? null,
      permission: dto.permission,
      expiresAt: dto.expiresAt ?? null,
      grantedBy: userIdOrNull(principal),
    });
    await this.projection.project(knowledgeId);
    await this.activity.recordSafe({
      principal,
      entityType: 'knowledge',
      entityId: knowledgeId,
      action: 'knowledge.access_granted',
      summary: `${dto.granteeType}: ${dto.permission}`,
    });
    return row;
  }

  async revoke(
    knowledgeId: string,
    grantId: string,
    principal: Principal,
  ): Promise<void> {
    await this.knowledge.require(knowledgeId, principal, 'manage');
    const removed = await this.repo.removeGrant(grantId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projection.project(knowledgeId);
    await this.activity.recordSafe({
      principal,
      entityType: 'knowledge',
      entityId: knowledgeId,
      action: 'knowledge.access_revoked',
    });
  }

  // --- contact links ---

  async listContacts(
    knowledgeId: string,
    principal: Principal,
  ): Promise<KnowledgeContactLinkRow[]> {
    await this.knowledge.require(knowledgeId, principal, 'read');
    return this.repo.contactLinks(knowledgeId);
  }

  /**
   * Attach a contact to a record.
   *
   * The link grants nothing in either direction: reading the article still
   * needs an ACL grant, and seeing the contact still needs contact scope.
   * Link-implies-grant is the most common way document ACLs leak.
   */
  async linkContact(
    knowledgeId: string,
    dto: LinkContactDto,
    principal: Principal,
  ): Promise<KnowledgeContactLinkRow> {
    await this.knowledge.require(knowledgeId, principal, 'write');
    return this.repo.linkContact({
      knowledgeId,
      contactId: dto.contactId,
      relation: dto.relation,
      note: dto.note,
      linkedBy: userIdOrNull(principal),
    });
  }

  async unlinkContact(
    knowledgeId: string,
    linkId: string,
    principal: Principal,
  ): Promise<void> {
    await this.knowledge.require(knowledgeId, principal, 'write');
    const removed = await this.repo.unlinkContact(linkId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  /**
   * Knowledge that references a contact, filtered to what the caller may read.
   *
   * Filtered rather than merely listed: the link table has no ACL of its own, so
   * returning ids here would disclose the existence of records the caller
   * cannot open.
   */
  async forContact(contactId: string, principal: Principal): Promise<string[]> {
    const ids = await this.repo.knowledgeIdsForContact(contactId);
    const readable: string[] = [];
    for (const id of ids) {
      if (await this.knowledge.canRead(id, principal)) readable.push(id);
    }
    return readable;
  }
}
