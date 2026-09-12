import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../infrastructure/search-engine/search-engine.interface';
import type {
  CollectionVisibility,
  FieldSpec,
} from '../../infrastructure/database/schema/search.schema';
import { CollectionRepository } from './collection.repository';
import {
  fieldSpecToIndexDefinition,
  validateVisibility,
} from './document-validator';
import { IndexRegistry } from './index-registry';
import { SearchRecordRepository } from './search-record.repository';
import {
  DROP_INDEX_JOB,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from './search.constants';
import { INDEXING_JOB_OPTS } from './search.util';

/** A collection as returned to API callers. */
export interface CollectionView {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  /** Read policy, surfaced so an admin can see who can read a collection. */
  visibility: CollectionVisibility;
  ownerField: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCollectionInput {
  name: string;
  displayName: string;
  description?: string;
  fields: FieldSpec[];
  /** Read policy. Omitted means `private` — the safe default, not the open one. */
  visibility?: CollectionVisibility;
  ownerField?: string | null;
}

export interface UpdateCollectionInput {
  displayName?: string;
  description?: string | null;
  fields?: FieldSpec[];
  visibility?: CollectionVisibility;
  ownerField?: string | null;
}

/** A collection this application owns and keeps converged at boot. */
export interface SystemCollectionSpec {
  name: string;
  displayName: string;
  description?: string;
  fields: FieldSpec[];
  visibility: CollectionVisibility;
  ownerField?: string | null;
}

/**
 * Manages the lifecycle of dynamic collections: the DB row, the Meili index +
 * settings, and the registry cache. Structural field-spec validation happens at
 * the DTO boundary; this service owns identity + Meili convergence.
 */
@Injectable()
export class CollectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly collections: CollectionRepository,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    private readonly errors: ExceptionService,
  ) {}

  /** Reject a policy that its own field spec cannot support. */
  private assertVisibility(
    visibility: CollectionVisibility,
    ownerField: string | null | undefined,
    fields: FieldSpec[],
  ): void {
    const errors = validateVisibility(visibility, ownerField, fields);
    if (errors.length) {
      throw this.errors.validation(
        errors.map((message) => ({ path: 'ownerField', message })),
      );
    }
  }

  /**
   * Create or converge a collection this application owns.
   *
   * Reconciling matters as much as creating: every database that predates the
   * `visibility` column already has these rows, and the migration defaults them
   * to `private`. A plain create-if-missing would therefore leave `documents`
   * admin-only and silently break the agent's `search-documents` tool for every
   * ordinary user.
   */
  async ensureSystemCollection(spec: SystemCollectionSpec): Promise<void> {
    const existing = await this.collections.findByName(spec.name);
    if (!existing) {
      await this.create(spec);
      this.logger.log(`Created "${spec.name}" collection`);
      return;
    }
    const ownerField = spec.ownerField ?? null;
    if (
      existing.visibility === spec.visibility &&
      existing.ownerField === ownerField
    ) {
      return;
    }
    await this.update(spec.name, { visibility: spec.visibility, ownerField });
    this.logger.log(
      `Converged "${spec.name}" read policy to ${spec.visibility}` +
        (ownerField ? ` (owner field "${ownerField}")` : ''),
    );
  }

  /** Warm the registry and converge Meili settings at boot (best-effort). */
  async onApplicationBootstrap(): Promise<void> {
    let compiled;
    try {
      compiled = await this.registry.warm();
    } catch (error) {
      this.logger.warn(
        `Failed to warm collection registry: ${asMessage(error)}`,
      );
      return;
    }
    for (const def of compiled) {
      try {
        await this.engine.ensureIndex(def.definition);
      } catch (error) {
        this.logger.warn(
          `Failed to ensure index "${def.name}": ${asMessage(error)}`,
        );
      }
    }
  }

  /**
   * Postgres row first, Meili index second. The reverse order — which this used
   * to do — orphans an index whenever the insert fails, and contradicts the rule
   * that Postgres is the source of truth. If `ensureIndex` fails the collection
   * still exists and its settings converge on the next write or the next boot.
   */
  async create(input: CreateCollectionInput): Promise<CollectionView> {
    if (await this.collections.findByName(input.name)) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_EXISTS, {
        message: `Collection "${input.name}" already exists`,
      });
    }
    const visibility = input.visibility ?? 'private';
    this.assertVisibility(visibility, input.ownerField, input.fields);
    const row = await this.collections.create({
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      fields: input.fields,
      visibility,
      ownerField: input.ownerField ?? null,
    });
    await this.registry.invalidate(input.name);

    try {
      await this.engine.ensureIndex(
        fieldSpecToIndexDefinition(input.name, input.fields),
      );
      // A recycled name can inherit documents from a previous collection whose
      // index outlived it (e.g. a failed delete). Settings alone would not
      // remove them, so start the new collection from an empty index.
      const cleared = await this.engine.clearIndex(input.name);
      await this.engine.waitForTask(cleared.taskUid);
    } catch (error) {
      this.logger.warn(
        `Collection "${input.name}" created, but its index is not yet converged ` +
          `(will retry on next write/boot): ${asMessage(error)}`,
      );
    }
    return toView(row);
  }

  async list(): Promise<CollectionView[]> {
    const rows = await this.collections.listActive();
    return rows.map(toView);
  }

  async get(name: string): Promise<CollectionView> {
    const row = await this.collections.findByName(name);
    if (!row) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    return toView(row);
  }

  async update(
    name: string,
    input: UpdateCollectionInput,
  ): Promise<CollectionView> {
    const existing = await this.collections.findByName(name);
    if (!existing) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }

    // Re-validate the policy against the MERGED state: a PATCH may change the
    // field spec, the visibility, or the owner field independently, and any of
    // the three can invalidate the combination. The DTO can only check a
    // request that happens to carry all of them.
    const visibility = input.visibility ?? existing.visibility;
    const ownerField =
      input.ownerField !== undefined ? input.ownerField : existing.ownerField;
    const fields = input.fields ?? existing.fields;
    this.assertVisibility(visibility, ownerField, fields);

    if (input.fields) {
      await this.engine.ensureIndex(
        fieldSpecToIndexDefinition(name, input.fields),
      );
    }
    const row = await this.collections.updateByName(name, {
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.fields !== undefined ? { fields: input.fields } : {}),
      ...(input.visibility !== undefined
        ? { visibility: input.visibility }
        : {}),
      ...(input.ownerField !== undefined
        ? { ownerField: input.ownerField }
        : {}),
    });
    if (!row) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    await this.registry.invalidate(name);

    if (input.fields) {
      await this.queue.add(
        REINDEX_COLLECTION_JOB,
        { collection: name },
        INDEXING_JOB_OPTS,
      );
    }
    return toView(row);
  }

  /**
   * Soft-delete the collection and its records, then drop the index. The records
   * are left `PENDING` and the drop is retried through the queue on failure, so
   * an index that outlives its collection is a transient state the pipeline
   * repairs rather than a silent orphan.
   */
  async remove(name: string): Promise<void> {
    const existing = await this.collections.findByName(name);
    if (!existing) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    await this.collections.softDeleteByName(name);
    await this.records.softDeleteByCollection(name);
    await this.registry.invalidate(name);
    try {
      const { taskUid } = await this.engine.deleteIndex(name);
      await this.engine.waitForTask(taskUid);
      // The documents are gone, so the soft-deleted rows have converged.
      await this.records.markCollectionPurged(name);
    } catch (error) {
      this.logger.warn(
        `Failed to delete index "${name}", queued for retry: ${asMessage(error)}`,
      );
      await this.queue
        .add(DROP_INDEX_JOB, { collection: name }, INDEXING_JOB_OPTS)
        .catch((queueError: unknown) =>
          this.logger.error(
            `Could not queue index drop for "${name}"; its documents remain ` +
              `searchable until an operator reloads or deletes the index: ${asMessage(queueError)}`,
          ),
        );
    }
  }
}

function toView(row: {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  visibility: CollectionVisibility;
  ownerField: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CollectionView {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    fields: row.fields,
    visibility: row.visibility,
    ownerField: row.ownerField,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
