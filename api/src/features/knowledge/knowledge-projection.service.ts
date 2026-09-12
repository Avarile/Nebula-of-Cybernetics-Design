import { Injectable, Logger } from '@nestjs/common';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import type { KnowledgeRow } from '../../infrastructure/database/schema/knowledge.schema';
import { SearchRecordService } from '../search-service/search-record.service';
import { KnowledgeAclRepository } from './knowledge-acl.repository';
import { KnowledgeRepository } from './knowledge.repository';

export const KNOWLEDGE_COLLECTION = 'knowledge';

/**
 * Ceiling on how many users an `internal` record expands to.
 *
 * See {@link KnowledgeProjectionService} for why the expansion exists and what
 * happens above the cap.
 */
const ACL_EXPANSION_CAP = 1_000;

/** Body text stored in the index. Full bodies bloat every hit and every reindex. */
const INDEXED_BODY_CHARS = 20_000;

/**
 * Field spec for the `knowledge` collection.
 *
 * `aclUserIds` is `string[]` and is the collection's `ownerField`: Meilisearch
 * matches `aclUserIds = "<uuid>"` against an array attribute by containment, so
 * the filter `resolveReadScope` already emits is correct without a second
 * enforcement point.
 */
export function knowledgeCollectionFields(): FieldSpec[] {
  return [
    { name: 'title', type: 'string', searchable: true },
    { name: 'summary', type: 'string', searchable: true },
    { name: 'body', type: 'string', searchable: true },
    { name: 'slug', type: 'string', filterable: true },
    { name: 'status', type: 'string', filterable: true },
    { name: 'visibility', type: 'string', filterable: true },
    { name: 'typeKey', type: 'string', filterable: true },
    { name: 'categoryPath', type: 'string', filterable: true },
    { name: 'tagIds', type: 'string[]', filterable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'aclUserIds', type: 'string[]', filterable: true },
    { name: 'updatedAt', type: 'string', sortable: true },
  ];
}

/**
 * Keeps the `knowledge` search collection in step with the table.
 *
 * The ACL array is a denormalization, so it goes stale on grant changes as well
 * as content changes — every caller that touches either must reproject. The
 * write path is the existing outbox (`search_records.index_state`), so a failure
 * here is repaired by the reconciliation sweep rather than lost.
 *
 * **Accepted, and stated:** propagation is eventually consistent. A revoked
 * grant may linger in search *results* for seconds; it never lingers in *reads*,
 * because `KnowledgeService.get` re-checks the ACL against Postgres. Search can
 * leak a title, never a body.
 */
@Injectable()
export class KnowledgeProjectionService {
  private readonly logger = new Logger(KnowledgeProjectionService.name);

  constructor(
    private readonly records: SearchRecordService,
    private readonly repo: KnowledgeRepository,
    private readonly acl: KnowledgeAclRepository,
  ) {}

  /** Project one record, or remove it from the index when it is gone. */
  async project(knowledgeId: string): Promise<void> {
    const row = await this.repo.findLiveById(knowledgeId);
    if (!row) {
      await this.records.remove(KNOWLEDGE_COLLECTION, knowledgeId);
      return;
    }
    const [tagIds, aclUserIds] = await Promise.all([
      this.repo.tagIdsFor(knowledgeId),
      this.resolveAclUserIds(row),
    ]);

    if (aclUserIds.length === 0) {
      // An empty scope is unreadable by design, and `persist` refuses it. Drop
      // the document instead of failing the caller's write: an ownerless,
      // ungranted draft simply is not findable yet.
      await this.records.remove(KNOWLEDGE_COLLECTION, knowledgeId);
      return;
    }

    await this.records.persist(KNOWLEDGE_COLLECTION, [
      {
        externalId: knowledgeId,
        document: {
          title: row.title,
          summary: row.summary ?? '',
          body: (row.body ?? '').slice(0, INDEXED_BODY_CHARS),
          slug: row.slug,
          status: row.status,
          visibility: row.visibility,
          ownerUserId: row.ownerUserId ?? '',
          tagIds,
          aclUserIds,
          updatedAt: row.updatedAt.toISOString(),
        },
      },
    ]);
  }

  async remove(knowledgeId: string): Promise<void> {
    await this.records.remove(KNOWLEDGE_COLLECTION, knowledgeId);
  }

  /**
   * Everyone who may read this record, as a flat list of user ids.
   *
   * `internal` visibility means "any authenticated user", which cannot be
   * expressed as a filter over a per-record array without listing them. For a
   * single-tenant deployment with tens of users that expansion is cheap and
   * exact. Past {@link ACL_EXPANSION_CAP} it is neither, so the projection
   * degrades to explicit grantees and says so loudly — the alternative would be
   * a silently truncated list that hides records from real users.
   */
  private async resolveAclUserIds(row: KnowledgeRow): Promise<string[]> {
    const ids = new Set<string>();
    if (row.ownerUserId) ids.add(row.ownerUserId);

    const [explicit, roleMembers, hasAuthenticated] = await Promise.all([
      this.acl.explicitUserIds(row.id),
      this.acl.roleMemberUserIds(row.id),
      this.acl.hasAuthenticatedGrant(row.id),
    ]);
    for (const id of explicit) ids.add(id);
    for (const id of roleMembers) ids.add(id);

    if (row.visibility === 'internal' || hasAuthenticated) {
      const everyone = await this.acl.allLiveUserIds(ACL_EXPANSION_CAP);
      if (everyone.length > ACL_EXPANSION_CAP) {
        this.logger.warn(
          `More than ${ACL_EXPANSION_CAP} users: search results for internal ` +
            `knowledge are limited to explicit grantees. Move to a filter-side ` +
            `ACL before relying on internal-visibility search.`,
        );
      } else {
        for (const id of everyone) ids.add(id);
      }
    }
    return [...ids];
  }
}
