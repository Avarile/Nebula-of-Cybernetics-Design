import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { CollectionService } from '../search-service/collection.service';
import {
  DOCUMENTS_COLLECTION,
  documentsCollectionFields,
} from './document-ingest.constants';

/** Bounded retry for the boot-time ensure. */
const ENSURE_ATTEMPTS = 5;
const ENSURE_BACKOFF_MS = 2_000;

/** Idempotently ensures the `documents` collection exists at app start. */
@Injectable()
export class DocumentsCollectionBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentsCollectionBootstrap.name);

  constructor(private readonly collections: CollectionService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureWithRetry();
  }

  /**
   * Retry with backoff instead of giving up after one attempt.
   *
   * Boot ordering between this hook, `MailboxService`'s and
   * `CollectionService.onApplicationBootstrap` is undefined, and the database
   * may still be warming up. Previously a single failure was swallowed and the
   * `documents` collection simply did not exist, so every subsequent ingest job
   * failed with SEARCH_COLLECTION_NOT_FOUND until someone restarted the process.
   */
  private async ensureWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= ENSURE_ATTEMPTS; attempt++) {
      try {
        await this.ensureOnce();
        return;
      } catch (error) {
        const last = attempt === ENSURE_ATTEMPTS;
        this.logger.warn(
          `Could not ensure "${DOCUMENTS_COLLECTION}" collection ` +
            `(attempt ${attempt}/${ENSURE_ATTEMPTS})${last ? '' : ', retrying'}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
        if (last) {
          this.logger.error(
            `"${DOCUMENTS_COLLECTION}" collection is missing; document ingest ` +
              `will fail until it exists.`,
          );
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, ENSURE_BACKOFF_MS * attempt),
        );
      }
    }
  }

  private async ensureOnce(): Promise<void> {
    // Create-or-reconcile, not create-if-missing: a database created before
    // the `visibility` column exists already has this row, and the migration
    // defaults it to `private` — which would make every user's own documents
    // invisible to them and to the agent's `search-documents` tool.
    await this.collections.ensureSystemCollection({
      name: DOCUMENTS_COLLECTION,
      displayName: 'Documents',
      description:
        'Extracted text from uploaded documents, searchable by the agent.',
      fields: documentsCollectionFields(),
      // Each document belongs to the user who uploaded it; reads are filtered
      // to the caller's own records (admins excepted).
      visibility: 'owner_scoped',
      ownerField: 'ownerUserId',
    });
  }
}
