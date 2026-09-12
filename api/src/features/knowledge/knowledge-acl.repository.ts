import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { users } from '../../infrastructure/database/schema/identity.schema';
import { userRoles } from '../../infrastructure/database/schema/rbac.schema';
import {
  knowledgeAccessControl,
  knowledgeContactLinks,
  type KnowledgeAccessControlRow,
  type KnowledgeContactLinkRow,
  type NewKnowledgeAccessControlRow,
  type NewKnowledgeContactLinkRow,
} from '../../infrastructure/database/schema/knowledge.schema';

@Injectable()
export class KnowledgeAclRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async grantsFor(knowledgeId: string): Promise<KnowledgeAccessControlRow[]> {
    return this.db
      .select()
      .from(knowledgeAccessControl)
      .where(
        and(
          eq(knowledgeAccessControl.knowledgeId, knowledgeId),
          eq(knowledgeAccessControl.isDeleted, false),
        ),
      );
  }

  /** Grants for many records at once, so a list page is one query, not N. */
  async grantsForMany(
    knowledgeIds: string[],
  ): Promise<Map<string, KnowledgeAccessControlRow[]>> {
    const byRecord = new Map<string, KnowledgeAccessControlRow[]>();
    if (knowledgeIds.length === 0) return byRecord;
    const rows = await this.db
      .select()
      .from(knowledgeAccessControl)
      .where(
        and(
          inArray(knowledgeAccessControl.knowledgeId, knowledgeIds),
          eq(knowledgeAccessControl.isDeleted, false),
        ),
      );
    for (const row of rows) {
      const list = byRecord.get(row.knowledgeId) ?? [];
      list.push(row);
      byRecord.set(row.knowledgeId, list);
    }
    return byRecord;
  }

  /** Role ids a user currently holds — the input to role-based grants. */
  async roleIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.isDeleted, false)));
    return rows.map((r) => r.roleId);
  }

  async createGrant(
    values: NewKnowledgeAccessControlRow,
  ): Promise<KnowledgeAccessControlRow> {
    const rows = await this.db
      .insert(knowledgeAccessControl)
      .values(values)
      .returning();
    return rows[0];
  }

  async removeGrant(id: string): Promise<boolean> {
    const rows = await this.db
      .update(knowledgeAccessControl)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(knowledgeAccessControl.id, id),
          eq(knowledgeAccessControl.isDeleted, false),
        ),
      )
      .returning({ id: knowledgeAccessControl.id });
    return rows.length > 0;
  }

  /** Users named by a record's grants — the seed of the search ACL array. */
  async explicitUserIds(knowledgeId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: knowledgeAccessControl.granteeUserId })
      .from(knowledgeAccessControl)
      .where(
        and(
          eq(knowledgeAccessControl.knowledgeId, knowledgeId),
          eq(knowledgeAccessControl.granteeType, 'user'),
          eq(knowledgeAccessControl.isDeleted, false),
        ),
      );
    return rows.map((r) => r.userId).filter((id): id is string => id !== null);
  }

  /** Members of the roles a record grants to. */
  async roleMemberUserIds(knowledgeId: string): Promise<string[]> {
    const grants = await this.db
      .select({ roleId: knowledgeAccessControl.granteeRoleId })
      .from(knowledgeAccessControl)
      .where(
        and(
          eq(knowledgeAccessControl.knowledgeId, knowledgeId),
          eq(knowledgeAccessControl.granteeType, 'role'),
          eq(knowledgeAccessControl.isDeleted, false),
        ),
      );
    const roleIds = grants
      .map((g) => g.roleId)
      .filter((id): id is string => id !== null);
    if (roleIds.length === 0) return [];
    const members = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(inArray(userRoles.roleId, roleIds), eq(userRoles.isDeleted, false)),
      );
    return members.map((m) => m.userId);
  }

  /** Whether a record grants to any authenticated caller. */
  async hasAuthenticatedGrant(knowledgeId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: knowledgeAccessControl.id })
      .from(knowledgeAccessControl)
      .where(
        and(
          eq(knowledgeAccessControl.knowledgeId, knowledgeId),
          eq(knowledgeAccessControl.granteeType, 'authenticated'),
          eq(knowledgeAccessControl.isDeleted, false),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Every live user id, capped.
   *
   * Used to expand `internal` visibility into the search ACL array. That is an
   * honest simplification for a single-tenant deployment with tens of users; it
   * does not scale, and the cap is what makes the failure visible instead of
   * silent. Above it, the caller logs and the projection degrades to explicit
   * grantees only.
   */
  async allLiveUserIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isDeleted, false))
      .limit(limit + 1);
    return rows.map((r) => r.id);
  }

  // --- contact links ---

  async contactLinks(knowledgeId: string): Promise<KnowledgeContactLinkRow[]> {
    return this.db
      .select()
      .from(knowledgeContactLinks)
      .where(
        and(
          eq(knowledgeContactLinks.knowledgeId, knowledgeId),
          eq(knowledgeContactLinks.isDeleted, false),
        ),
      );
  }

  async linkContact(
    values: NewKnowledgeContactLinkRow,
  ): Promise<KnowledgeContactLinkRow> {
    const rows = await this.db
      .insert(knowledgeContactLinks)
      .values(values)
      .returning();
    return rows[0];
  }

  async unlinkContact(id: string): Promise<boolean> {
    const rows = await this.db
      .update(knowledgeContactLinks)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(knowledgeContactLinks.id, id),
          eq(knowledgeContactLinks.isDeleted, false),
        ),
      )
      .returning({ id: knowledgeContactLinks.id });
    return rows.length > 0;
  }

  /** Knowledge referencing one contact — "everything we know about them". */
  async knowledgeIdsForContact(contactId: string): Promise<string[]> {
    const rows = await this.db
      .select({ knowledgeId: knowledgeContactLinks.knowledgeId })
      .from(knowledgeContactLinks)
      .where(
        and(
          eq(knowledgeContactLinks.contactId, contactId),
          eq(knowledgeContactLinks.isDeleted, false),
        ),
      );
    return rows.map((r) => r.knowledgeId);
  }
}
