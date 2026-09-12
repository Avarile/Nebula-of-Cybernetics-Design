import { Injectable } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  ProjectContactLinkRow,
  ProjectKnowledgeLinkRow,
  TimeEntryRow,
} from '../../infrastructure/database/schema/project-link.schema';
import { ActivityService } from '../shared/activity.service';
import { ContactService } from '../contacts/contact.service';
import type {
  LinkKnowledgeDto,
  LinkProjectContactDto,
} from './dto/project.dto';
import type { ListTimeDto, LogTimeDto, UpdateTimeDto } from './dto/task.dto';
import {
  ProjectLinkRepository,
  type TimeEntryQuery,
} from './project-link.repository';
import { ProjectService } from './project.service';
import { TaskRepository } from './task.repository';

/**
 * References from a project to knowledge and contacts, plus logged time.
 *
 * A link grants nothing: referencing an article from a project the caller can
 * read does not make the article readable, and the knowledge ACL still decides.
 * Link-implies-grant is the most common way document ACLs leak.
 */
@Injectable()
export class ProjectLinkService {
  constructor(
    private readonly repo: ProjectLinkRepository,
    private readonly projects: ProjectService,
    private readonly contacts: ContactService,
    private readonly tasks: TaskRepository,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  // --- knowledge ---

  async knowledgeLinks(
    projectId: string,
    principal: Principal,
  ): Promise<ProjectKnowledgeLinkRow[]> {
    await this.projects.require(projectId, principal, 'viewer');
    return this.repo.knowledgeLinks(projectId);
  }

  async linkKnowledge(
    projectId: string,
    dto: LinkKnowledgeDto,
    principal: Principal,
  ): Promise<ProjectKnowledgeLinkRow> {
    await this.projects.require(projectId, principal, 'contributor');
    return this.repo.linkKnowledge({
      projectId,
      knowledgeId: dto.knowledgeId,
      taskId: dto.taskId,
      relation: dto.relation,
      note: dto.note,
      linkedBy: userIdOrNull(principal),
    });
  }

  async unlinkKnowledge(
    projectId: string,
    linkId: string,
    principal: Principal,
  ): Promise<void> {
    await this.projects.require(projectId, principal, 'contributor');
    const removed = await this.repo.unlinkKnowledge(linkId, projectId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  // --- contacts ---

  async contactLinks(
    projectId: string,
    principal: Principal,
  ): Promise<ProjectContactLinkRow[]> {
    await this.projects.require(projectId, principal, 'viewer');
    return this.repo.contactLinks(projectId);
  }

  async linkContact(
    projectId: string,
    dto: LinkProjectContactDto,
    principal: Principal,
  ): Promise<ProjectContactLinkRow> {
    await this.projects.require(projectId, principal, 'contributor');
    // The caller must be able to see the contact, or linking would disclose one.
    if (!(await this.contacts.canRead(dto.contactId, principal))) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: 'Contact not found',
      });
    }
    const contact = await this.contacts.get(dto.contactId, principal);
    if (dto.isPrimary) {
      await this.repo.clearPrimaryContact(projectId, dto.relationship);
    }
    return this.repo.linkContact({
      projectId,
      contactId: dto.contactId,
      // Snapshotted: a contact can change employer, and the project's client
      // must not silently change with them.
      companyId: contact.companyId,
      relationship: dto.relationship,
      isPrimary: dto.isPrimary,
      note: dto.note,
      linkedBy: userIdOrNull(principal),
    });
  }

  async unlinkContact(
    projectId: string,
    linkId: string,
    principal: Principal,
  ): Promise<void> {
    await this.projects.require(projectId, principal, 'contributor');
    const removed = await this.repo.unlinkContact(linkId, projectId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  // --- time ---

  async listTime(dto: ListTimeDto, principal: Principal) {
    const query: TimeEntryQuery = { ...dto };
    if (dto.projectId) {
      await this.projects.require(dto.projectId, principal, 'viewer');
    } else if (principal.kind === 'user') {
      // Without a project, a caller sees only their own time. Anything else
      // would expose a colleague's timesheet.
      query.userId = principal.userId;
    } else {
      // Fail closed. A principal that is neither scoped to a project nor to a
      // user id has no timesheet of its own to narrow to, and falling through
      // here would run the query unfiltered across the whole installation.
      // Today `@Roles('user','admin')` keeps service credentials off this
      // route; that guard must not be the only thing standing between an agent
      // and every hour anyone has logged.
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Listing time requires a project filter or a user account',
      });
    }
    const { rows, total } = await this.repo.listTimeEntries(query);
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async logTime(
    taskId: string,
    dto: LogTimeDto,
    principal: Principal,
  ): Promise<TimeEntryRow> {
    const task = await this.tasks.findLiveById(taskId);
    if (!task) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projects.require(task.projectId, principal, 'contributor');
    const userId = this.projects.requireUser(principal);

    const row = await this.repo.createTimeEntry({
      taskId,
      // Denormalized from the task so project reports never join through tasks.
      projectId: task.projectId,
      userId,
      minutes: dto.minutes,
      workDate: dto.workDate.toISOString().slice(0, 10),
      startedAt: dto.startedAt,
      description: dto.description,
      isBillable: dto.isBillable,
      // Snapshotted at entry time; rates change and history must not.
      hourlyRate: dto.hourlyRate,
      currency: dto.currency,
    });
    await this.tasks.refreshSpentMinutes(taskId);
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: taskId,
      projectId: task.projectId,
      action: 'task.time_logged',
      summary: `${dto.minutes} minutes`,
    });
    return row;
  }

  async removeTime(id: string, principal: Principal): Promise<void> {
    const entry = await this.requireOwnEntryOrManager(id, principal, 'removed');
    await this.repo.softDeleteTimeEntry(id);
    if (entry.taskId) await this.tasks.refreshSpentMinutes(entry.taskId);
  }

  /**
   * Correct a logged entry.
   *
   * `updateTimeEntry` existed on the repository with no caller and no route, so
   * a mistyped duration could only be deleted and re-logged — which loses the
   * original `createdAt` and any audit trail attached to it. Same ownership
   * rule as removal, and the same refusal once an invoice is billing it.
   */
  async updateTime(
    id: string,
    dto: UpdateTimeDto,
    principal: Principal,
  ): Promise<TimeEntryRow> {
    await this.requireOwnEntryOrManager(id, principal, 'edited');
    const updated = await this.repo.updateTimeEntry(id, {
      ...dto,
      workDate: dto.workDate
        ? dto.workDate.toISOString().slice(0, 10)
        : undefined,
    });
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (updated.taskId) await this.tasks.refreshSpentMinutes(updated.taskId);
    return updated;
  }

  /**
   * Load an entry and check the caller may change it.
   *
   * Your own time needs `contributor`; someone else's needs `manager` — editing
   * a colleague's timesheet is a supervisory act. An invoiced entry is frozen
   * either way: `invoice_line_item_id` is the double-billing lock and the
   * invoice line's only link back to the work it charges for.
   */
  private async requireOwnEntryOrManager(
    id: string,
    principal: Principal,
    verb: string,
  ): Promise<TimeEntryRow> {
    const entry = await this.repo.findTimeEntry(id);
    if (!entry) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (entry.invoiceLineItemId) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `This entry has been invoiced and cannot be ${verb}`,
      });
    }
    const isOwn =
      principal.kind === 'user' && entry.userId === principal.userId;
    await this.projects.require(
      entry.projectId,
      principal,
      isOwn ? 'contributor' : 'manager',
    );
    return entry;
  }

  /** Billable, unbilled entries — what the finance module invoices. */
  async unbilledFor(
    projectId: string,
    principal: Principal,
  ): Promise<TimeEntryRow[]> {
    await this.projects.require(projectId, principal, 'manager');
    return this.repo.unbilledFor(projectId);
  }
}
