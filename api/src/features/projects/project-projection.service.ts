import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import { SearchRecordService } from '../search-service/search-record.service';
import {
  DEPROJECT_PROJECT_JOB,
  PROJECT_PROJECTION_QUEUE,
  PROJECTION_JOB_OPTS,
  REPROJECT_PROJECT_JOB,
} from './project.constants';
import { ProjectRepository } from './project.repository';
import { TaskRepository } from './task.repository';

export const PROJECTS_COLLECTION = 'projects';
export const TASKS_COLLECTION = 'tasks';

/** Field specs. `memberUserIds` is the ACL array both collections scope on. */
export function projectsCollectionFields(): FieldSpec[] {
  return [
    { name: 'key', type: 'string', searchable: true, filterable: true },
    { name: 'name', type: 'string', searchable: true },
    { name: 'description', type: 'string', searchable: true },
    { name: 'status', type: 'string', filterable: true },
    { name: 'priority', type: 'string', filterable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'memberUserIds', type: 'string[]', filterable: true },
    { name: 'tagIds', type: 'string[]', filterable: true },
    { name: 'updatedAt', type: 'string', sortable: true },
  ];
}

export function tasksCollectionFields(): FieldSpec[] {
  return [
    { name: 'number', type: 'number', filterable: true, sortable: true },
    { name: 'reference', type: 'string', searchable: true, filterable: true },
    { name: 'title', type: 'string', searchable: true },
    { name: 'description', type: 'string', searchable: true },
    { name: 'status', type: 'string', filterable: true },
    { name: 'priority', type: 'string', filterable: true },
    { name: 'projectId', type: 'string', filterable: true },
    { name: 'projectKey', type: 'string', filterable: true },
    { name: 'assigneeUserId', type: 'string', filterable: true },
    { name: 'memberUserIds', type: 'string[]', filterable: true },
    { name: 'dueDate', type: 'string', filterable: true, sortable: true },
  ];
}

/** Body text stored per task; full descriptions bloat every hit and reindex. */
const INDEXED_DESCRIPTION_CHARS = 10_000;

/**
 * Projects projects and tasks into the search index.
 *
 * Both scope on the project's member set, because a task's readability is its
 * project's. That makes membership changes a fan-out: adding one member
 * reprojects the project AND every task in it, which is why
 * {@link reprojectProjectAndTasks} exists and why callers must not inline it —
 * a thousand-task project would otherwise block the request that added a member.
 */
@Injectable()
export class ProjectProjectionService {
  private readonly logger = new Logger(ProjectProjectionService.name);

  constructor(
    private readonly records: SearchRecordService,
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    @InjectQueue(PROJECT_PROJECTION_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Hand the per-task fan-out to the queue.
   *
   * The producers — adding a member, removing one, changing ownership or
   * visibility — all need the project's own document refreshed immediately
   * (that is the row whose scope just changed and which the caller will read
   * back) but can let the tasks converge behind them.
   *
   * A failed handoff is logged, not thrown: the caller's write already
   * committed, and refusing their request because Redis blinked would be worse
   * than briefly stale search results. The search reconciliation sweep is the
   * backstop, exactly as it is for `SearchRecordService.enqueueIndexJobs`.
   */
  async enqueueReprojection(projectId: string): Promise<void> {
    await this.projectProject(projectId);
    await this.enqueue(REPROJECT_PROJECT_JOB, { projectId });
  }

  /** Drop a deleted project's tasks from the index, off the request path. */
  async enqueueDeprojection(
    projectId: string,
    taskIds: string[],
  ): Promise<void> {
    await this.removeProject(projectId);
    if (taskIds.length === 0) return;
    await this.enqueue(DEPROJECT_PROJECT_JOB, { projectId, taskIds });
  }

  private async enqueue(
    job: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.queue.add(job, data, PROJECTION_JOB_OPTS);
    } catch (error) {
      this.logger.warn(
        `Projection handoff failed for "${job}" — leaving it to the ` +
          `reconciliation sweep: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  async projectProject(projectId: string): Promise<void> {
    const row = await this.projects.findLiveById(projectId);
    if (!row) {
      await this.records.remove(PROJECTS_COLLECTION, projectId);
      return;
    }
    const scope = await this.scopeFor(projectId, row.ownerUserId);
    if (scope.length === 0) {
      // Unreadable by anyone but an admin, and `persist` refuses an empty
      // scope. Drop it rather than fail the caller's write.
      await this.records.remove(PROJECTS_COLLECTION, projectId);
      return;
    }
    const tagIds = await this.projects.tagIdsFor(projectId);
    await this.records.persist(PROJECTS_COLLECTION, [
      {
        externalId: projectId,
        document: {
          key: row.key,
          name: row.name,
          description: (row.description ?? '').slice(
            0,
            INDEXED_DESCRIPTION_CHARS,
          ),
          status: row.status,
          priority: row.priority,
          ownerUserId: row.ownerUserId ?? '',
          memberUserIds: scope,
          tagIds,
          updatedAt: row.updatedAt.toISOString(),
        },
      },
    ]);
  }

  async projectTask(taskId: string): Promise<void> {
    const task = await this.tasks.findLiveById(taskId);
    if (!task) {
      await this.records.remove(TASKS_COLLECTION, taskId);
      return;
    }
    const project = await this.projects.findLiveById(task.projectId);
    if (!project) {
      await this.records.remove(TASKS_COLLECTION, taskId);
      return;
    }
    const scope = await this.scopeFor(project.id, project.ownerUserId);
    if (scope.length === 0) {
      await this.records.remove(TASKS_COLLECTION, taskId);
      return;
    }
    await this.records.persist(TASKS_COLLECTION, [
      {
        externalId: taskId,
        document: {
          number: task.number,
          reference: `${project.key}-${task.number}`,
          title: task.title,
          description: (task.description ?? '').slice(
            0,
            INDEXED_DESCRIPTION_CHARS,
          ),
          status: task.status,
          priority: task.priority,
          projectId: project.id,
          projectKey: project.key,
          assigneeUserId: task.assigneeUserId ?? '',
          memberUserIds: scope,
          dueDate: task.dueDate ?? '',
        },
      },
    ]);
  }

  async removeTask(taskId: string): Promise<void> {
    await this.records.remove(TASKS_COLLECTION, taskId);
  }

  /** Drop a batch of tasks from the index — the deprojection job's body. */
  async removeTasks(taskIds: string[]): Promise<void> {
    for (const id of taskIds) await this.removeTask(id);
  }

  async removeProject(projectId: string): Promise<void> {
    await this.records.remove(PROJECTS_COLLECTION, projectId);
  }

  /**
   * Reproject a project and every task in it.
   *
   * Called after a membership change, which invalidates the scope array on all
   * of them. Bounded by page so one enormous project cannot hold the event loop;
   * the reconciliation sweep repairs anything a failure leaves behind.
   *
   * This is the QUEUE JOB's body, not something a request handler calls —
   * {@link enqueueReprojection} is the producers' entry point. Inlined, this
   * cost ~32 ms per task inside the HTTP request that changed the membership.
   */
  async reprojectProjectAndTasks(projectId: string): Promise<void> {
    await this.projectProject(projectId);
    let page = 1;
    for (;;) {
      const { rows } = await this.tasks.list({ projectId, page, limit: 200 });
      if (rows.length === 0) break;
      for (const task of rows) {
        await this.projectTask(task.id);
      }
      if (rows.length < 200) break;
      page += 1;
    }
  }

  /** Owner plus members — everyone who may read anything under the project. */
  private async scopeFor(
    projectId: string,
    ownerUserId: string | null,
  ): Promise<string[]> {
    const ids = new Set(await this.projects.memberUserIds(projectId));
    if (ownerUserId) ids.add(ownerUserId);
    return [...ids];
  }
}
