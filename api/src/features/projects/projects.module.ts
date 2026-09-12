import { BullModule } from '@nestjs/bullmq';
import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { ContactsModule } from '../contacts/contacts.module';
import { SearchServiceModule } from '../search-service/search-service.module';
import { EntityAccessRegistry } from '../shared/entity-access.registry';
import { SharedModule } from '../shared/shared.module';
import { PlanningRepository } from './planning.repository';
import { ProjectProjectionProcessor } from './processors/project-projection.processor';
import { PROJECT_PROJECTION_QUEUE } from './project.constants';
import { PlanningService } from './planning.service';
import { ProjectCollectionBootstrap } from './project-collection.bootstrap';
import { ProjectLinkRepository } from './project-link.repository';
import { ProjectLinkService } from './project-link.service';
import { ProjectProjectionService } from './project-projection.service';
import { ProjectController } from './project.controller';
import { ProjectRepository } from './project.repository';
import { ProjectService } from './project.service';
import { TaskBoardService } from './task-board.service';
import { TaskController } from './task.controller';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';

/**
 * Project management: projects, membership, tasks, planning artefacts,
 * references to knowledge and contacts, and logged time.
 *
 * Depends on `ContactsModule` so a contact link can be authorized against the
 * contact's own scope — linking must not be a way to discover contacts.
 */
@Module({
  imports: [
    SharedModule,
    SearchServiceModule,
    ContactsModule,
    QueueModule,
    BullModule.registerQueue({ name: PROJECT_PROJECTION_QUEUE }),
  ],
  controllers: [ProjectController, TaskController],
  providers: [
    ProjectRepository,
    TaskRepository,
    PlanningRepository,
    ProjectLinkRepository,
    ProjectProjectionService,
    ProjectProjectionProcessor,
    ProjectService,
    TaskService,
    TaskBoardService,
    PlanningService,
    ProjectLinkService,
    ProjectCollectionBootstrap,
  ],
  exports: [
    ProjectService,
    TaskService,
    ProjectLinkService,
    // Exported for FinanceModule, which stamps billed entries when it turns
    // logged time into an invoice line.
    ProjectLinkRepository,
  ],
})
export class ProjectsModule implements OnApplicationBootstrap {
  constructor(
    private readonly access: EntityAccessRegistry,
    private readonly projects: ProjectService,
    private readonly tasks: TaskService,
    private readonly planning: PlanningService,
  ) {}

  onApplicationBootstrap(): void {
    // Comments and attachments on projects and tasks stay admin-only until
    // these resolvers are registered.
    this.access.register('project', (id, principal) =>
      this.projects.canRead(id, principal),
    );
    this.access.register('task', (id, principal) =>
      this.tasks.canRead(id, principal),
    );
    // Milestones and goals hang off a project and have no separate ACL, so they
    // resolve through the project that owns them — the same delegation `task`
    // uses. These were stubbed to a constant `false`, which did not mean
    // "inherit the project's ACL" but "deny everyone except admins", so a
    // manager could not comment on their own milestone. An organizational goal
    // belongs to no project and stays admin-only, which `canReadGoal` reports.
    this.access.register('milestone', (id, principal) =>
      this.planning.canReadMilestone(id, principal),
    );
    this.access.register('goal', (id, principal) =>
      this.planning.canReadGoal(id, principal),
    );
  }
}
