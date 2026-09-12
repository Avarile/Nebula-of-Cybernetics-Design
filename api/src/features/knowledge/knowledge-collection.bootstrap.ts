import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { CollectionService } from '../search-service/collection.service';
import {
  KNOWLEDGE_COLLECTION,
  knowledgeCollectionFields,
} from './knowledge-projection.service';

/** Bounded retry, matching `DocumentsCollectionBootstrap`. */
const ENSURE_ATTEMPTS = 5;
const ENSURE_BACKOFF_MS = 2_000;

/**
 * Idempotently ensures the `knowledge` collection exists at start.
 *
 * Create-or-reconcile, not create-if-missing, and retried: boot ordering
 * between bootstraps is undefined and the database may still be warming up. A
 * single swallowed failure is how the `documents` collection once ended up
 * missing until someone restarted the process.
 */
@Injectable()
export class KnowledgeCollectionBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeCollectionBootstrap.name);

  constructor(private readonly collections: CollectionService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (let attempt = 1; attempt <= ENSURE_ATTEMPTS; attempt++) {
      try {
        await this.collections.ensureSystemCollection({
          name: KNOWLEDGE_COLLECTION,
          displayName: 'Knowledge',
          description:
            'Curated knowledge records, scoped by their access grants.',
          fields: knowledgeCollectionFields(),
          // Scoped by an ARRAY of permitted user ids: Meilisearch matches
          // `aclUserIds = "<uuid>"` against an array attribute by containment,
          // so `resolveReadScope` enforces this without a second code path.
          visibility: 'owner_scoped',
          ownerField: 'aclUserIds',
        });
        return;
      } catch (error) {
        const last = attempt === ENSURE_ATTEMPTS;
        this.logger.warn(
          `Could not ensure "${KNOWLEDGE_COLLECTION}" collection ` +
            `(attempt ${attempt}/${ENSURE_ATTEMPTS})${last ? '' : ', retrying'}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
        if (last) {
          this.logger.error(
            `"${KNOWLEDGE_COLLECTION}" collection is missing; knowledge search ` +
              `will be empty until it exists.`,
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
