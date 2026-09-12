import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  projectContactLinks,
  projectKnowledgeLinks,
  timeEntries,
  type NewProjectContactLinkRow,
  type NewProjectKnowledgeLinkRow,
  type NewTimeEntryRow,
  type ProjectContactLinkRow,
  type ProjectKnowledgeLinkRow,
  type TimeEntryRow,
} from '../../infrastructure/database/schema/project-link.schema';

export interface TimeEntryQuery {
  projectId?: string;
  taskId?: string;
  userId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

@Injectable()
export class ProjectLinkRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // --- knowledge links ---

  knowledgeLinks(projectId: string): Promise<ProjectKnowledgeLinkRow[]> {
    return this.db
      .select()
      .from(projectKnowledgeLinks)
      .where(
        and(
          eq(projectKnowledgeLinks.projectId, projectId),
          eq(projectKnowledgeLinks.isDeleted, false),
        ),
      );
  }

  async linkKnowledge(
    values: NewProjectKnowledgeLinkRow,
  ): Promise<ProjectKnowledgeLinkRow> {
    const rows = await this.db
      .insert(projectKnowledgeLinks)
      .values(values)
      .returning();
    return rows[0];
  }

  /**
   * Remove a knowledge reference belonging to `projectId`.
   *
   * Scoped to the project the caller was authorized against, not to the link id
   * alone: the route checks `projectId` and then deletes `id`, so without this
   * predicate a contributor on one project can unlink a reference from any
   * other. Returning false for a foreign id lets the caller 404 it.
   */
  async unlinkKnowledge(id: string, projectId: string): Promise<boolean> {
    const rows = await this.db
      .update(projectKnowledgeLinks)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(projectKnowledgeLinks.id, id),
          eq(projectKnowledgeLinks.projectId, projectId),
          eq(projectKnowledgeLinks.isDeleted, false),
        ),
      )
      .returning({ id: projectKnowledgeLinks.id });
    return rows.length > 0;
  }

  // --- contact links ---

  contactLinks(projectId: string): Promise<ProjectContactLinkRow[]> {
    return this.db
      .select()
      .from(projectContactLinks)
      .where(
        and(
          eq(projectContactLinks.projectId, projectId),
          eq(projectContactLinks.isDeleted, false),
        ),
      );
  }

  /** Clear an existing primary before setting one, per the partial unique index. */
  async clearPrimaryContact(
    projectId: string,
    relationship: ProjectContactLinkRow['relationship'],
  ): Promise<void> {
    await this.db
      .update(projectContactLinks)
      .set({ isPrimary: false })
      .where(
        and(
          eq(projectContactLinks.projectId, projectId),
          eq(projectContactLinks.relationship, relationship),
          eq(projectContactLinks.isPrimary, true),
        ),
      );
  }

  async linkContact(
    values: NewProjectContactLinkRow,
  ): Promise<ProjectContactLinkRow> {
    const rows = await this.db
      .insert(projectContactLinks)
      .values(values)
      .returning();
    return rows[0];
  }

  /** Remove a contact link belonging to `projectId`. Scoped for the same reason
   * as {@link unlinkKnowledge}. */
  async unlinkContact(id: string, projectId: string): Promise<boolean> {
    const rows = await this.db
      .update(projectContactLinks)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(projectContactLinks.id, id),
          eq(projectContactLinks.projectId, projectId),
          eq(projectContactLinks.isDeleted, false),
        ),
      )
      .returning({ id: projectContactLinks.id });
    return rows.length > 0;
  }

  /**
   * Retire every knowledge and contact reference under a project.
   *
   * Two statements, both in the caller's transaction. A link that outlives its
   * project is unreachable — every read goes through `projects.require` — but
   * still counts against the unique indexes, so re-creating the project's key
   * and re-linking the same article would collide with a row nobody can see.
   */
  async softDeleteLinksForProject(
    projectId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<{ knowledge: number; contacts: number }> {
    const stamp = { isDeleted: true as const, deletedAt: new Date() };
    const knowledge = await executor
      .update(projectKnowledgeLinks)
      .set(stamp)
      .where(
        and(
          eq(projectKnowledgeLinks.projectId, projectId),
          eq(projectKnowledgeLinks.isDeleted, false),
        ),
      )
      .returning({ id: projectKnowledgeLinks.id });
    const contacts = await executor
      .update(projectContactLinks)
      .set(stamp)
      .where(
        and(
          eq(projectContactLinks.projectId, projectId),
          eq(projectContactLinks.isDeleted, false),
        ),
      )
      .returning({ id: projectContactLinks.id });
    return { knowledge: knowledge.length, contacts: contacts.length };
  }

  /**
   * Retire a project's time entries — except any already billed.
   *
   * `invoice_line_item_id IS NOT NULL` is the double-billing lock and also the
   * link an invoice line has back to the work it charges for. Soft-deleting a
   * billed entry would leave an invoice billing hours that no longer exist,
   * which is exactly what `removeTime` refuses to do one entry at a time.
   */
  async softDeleteTimeEntriesForProject(
    projectId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(timeEntries)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(timeEntries.projectId, projectId),
          isNull(timeEntries.invoiceLineItemId),
          eq(timeEntries.isDeleted, false),
        ),
      )
      .returning({ id: timeEntries.id });
    return rows.length;
  }

  // --- time entries ---

  async listTimeEntries(
    q: TimeEntryQuery,
  ): Promise<{ rows: TimeEntryRow[]; total: number }> {
    const filters: SQL[] = [eq(timeEntries.isDeleted, false)];
    if (q.projectId) filters.push(eq(timeEntries.projectId, q.projectId));
    if (q.taskId) filters.push(eq(timeEntries.taskId, q.taskId));
    if (q.userId) filters.push(eq(timeEntries.userId, q.userId));
    if (q.from) filters.push(sql`${timeEntries.workDate} >= ${q.from}`);
    if (q.to) filters.push(sql`${timeEntries.workDate} <= ${q.to}`);
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(timeEntries)
      .where(where)
      .orderBy(desc(timeEntries.workDate))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(timeEntries)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async findTimeEntry(id: string): Promise<TimeEntryRow | null> {
    const rows = await this.db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createTimeEntry(values: NewTimeEntryRow): Promise<TimeEntryRow> {
    const rows = await this.db.insert(timeEntries).values(values).returning();
    return rows[0];
  }

  async updateTimeEntry(
    id: string,
    patch: Partial<NewTimeEntryRow>,
  ): Promise<TimeEntryRow | null> {
    const rows = await this.db
      .update(timeEntries)
      .set(patch)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteTimeEntry(id: string): Promise<void> {
    await this.db
      .update(timeEntries)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(timeEntries.id, id));
  }

  /**
   * Billable, unbilled entries for a project.
   *
   * Hits `time_entries_unbilled_idx`, which is partial on exactly this
   * predicate. `invoice_line_item_id IS NULL` is the double-billing lock: an
   * entry already on an invoice is invisible here.
   */
  unbilledFor(projectId: string): Promise<TimeEntryRow[]> {
    return this.db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.projectId, projectId),
          eq(timeEntries.isBillable, true),
          isNull(timeEntries.invoiceLineItemId),
          eq(timeEntries.isDeleted, false),
        ),
      )
      .orderBy(asc(timeEntries.workDate));
  }

  /**
   * Stamp entries as billed, in one statement, when an invoice line is made.
   *
   * Returns the ids it actually claimed. The caller must compare that against
   * what it asked for: `unbilledFor` and this update run at different moments,
   * so two concurrent bills of the same entries would otherwise both succeed
   * and the second would silently overwrite the first entry's line item —
   * double-billing the client for one piece of work.
   *
   * The predicate re-checks `invoice_line_item_id IS NULL` for that reason: the
   * claim has to be atomic with the test, not merely after it.
   *
   * Takes an executor so it can join the caller's transaction. Run outside it,
   * a failure between the line item and these flags leaves an invoice billing
   * time that is still marked unbilled.
   */
  async markBilled(
    ids: string[],
    invoiceLineItemId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const claimed = await executor
      .update(timeEntries)
      .set({ invoiceLineItemId })
      .where(
        and(
          inArray(timeEntries.id, ids),
          isNull(timeEntries.invoiceLineItemId),
          eq(timeEntries.isDeleted, false),
        ),
      )
      .returning({ id: timeEntries.id });
    return claimed.map((r) => r.id);
  }

  /**
   * Return every entry billed to a line item back to the unbilled pool.
   *
   * The counterpart to `markBilled`, and the reason removing an invoice line is
   * not simply a delete. `unbilledFor` treats `invoice_line_item_id IS NULL` as
   * the double-billing lock, so a line that was deleted without clearing the
   * stamp took its hours with it: they stayed pointed at a soft-deleted row,
   * invisible to every future invoice and unbillable forever.
   *
   * Returns the ids it released so the caller can report what came back.
   */
  async releaseBilled(
    invoiceLineItemId: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<string[]> {
    const released = await executor
      .update(timeEntries)
      .set({ invoiceLineItemId: null })
      .where(
        and(
          eq(timeEntries.invoiceLineItemId, invoiceLineItemId),
          eq(timeEntries.isDeleted, false),
        ),
      )
      .returning({ id: timeEntries.id });
    return released.map((r) => r.id);
  }
}
