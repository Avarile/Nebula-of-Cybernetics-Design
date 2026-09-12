import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { CollectionService } from '../search-service/collection.service';
import {
  PROJECTS_COLLECTION,
  TASKS_COLLECTION,
  projectsCollectionFields,
  tasksCollectionFields,
} from './project-projection.service';

const ENSURE_ATTEMPTS = 5;
const ENSURE_BACKOFF_MS = 2_000;

/**
 * Ensures the `projects` and `tasks` collections exist at start.
 *
 * Both are scoped by `memberUserIds` — a task's readability is its project's,
 * so the two collections share one scope array and one enforcement point.
 */
@Injectable()
export class ProjectCollectionBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectCollectionBootstrap.name);

  constructor(private readonly collections: CollectionService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure(
      PROJECTS_COLLECTION,
      'Projects',
      projectsCollectionFields(),
    );
    await this.ensure(TASKS_COLLECTION, 'Tasks', tasksCollectionFields());
  }

  private async ensure(
    name: string,
    displayName: string,
    fields: ReturnType<typeof projectsCollectionFields>,
  ): Promise<void> {
    for (let attempt = 1; attempt <= ENSURE_ATTEMPTS; attempt++) {
      try {
        await this.collections.ensureSystemCollection({
          name,
          displayName,
          description: `${displayName}, scoped to project membership.`,
          fields,
          visibility: 'owner_scoped',
          ownerField: 'memberUserIds',
        });
        return;
      } catch (error) {
        const last = attempt === ENSURE_ATTEMPTS;
        this.logger.warn(
          `Could not ensure "${name}" collection (attempt ${attempt}/${ENSURE_ATTEMPTS})` +
            `${last ? '' : ', retrying'}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
        if (last) {
          this.logger.error(
            `"${name}" collection is missing; that search will be empty.`,
          );
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, ENSURE_BACKOFF_MS * attempt),
        );
      }
    }
  }
}
