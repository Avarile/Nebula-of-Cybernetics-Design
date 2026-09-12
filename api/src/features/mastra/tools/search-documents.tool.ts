import { createTool } from '@mastra/core/tools';
import { userIdOrNull } from '../../../common/principal';
import { z } from 'zod';
import { DOCUMENTS_COLLECTION } from '../../document-ingest/document-ingest.constants';
import type {
  CuratedSearchResult,
  ToolRuntime,
  ToolServices,
} from '../mastra.types';
import { readRuntime } from './tool-context';

export const searchDocumentsInput = z.object({
  query: z
    .string()
    .default('')
    .describe(
      'Full-text query over uploaded documents. Pass "" to list the user\'s documents.',
    ),
  topK: z.number().int().positive().max(25).default(10),
});
export type SearchDocumentsInput = z.infer<typeof searchDocumentsInput>;

const MAX_TOP_K = 25;
const EMPTY: CuratedSearchResult = {
  collection: DOCUMENTS_COLLECTION,
  totalHits: 0,
  hits: [],
};

/**
 * Pure logic — unit tested.
 *
 * Owner scoping is NOT applied here any more. The `documents` collection is
 * declared `owner_scoped`, and `SearchRecordService.search` injects the owner
 * filter from the principal. Filtering in the tool as well was the original
 * split-brain: this tool scoped correctly while `search-query` did not, because
 * scoping was the caller's job. One enforcement point, not two.
 */
export async function searchDocumentsExecute(
  input: SearchDocumentsInput,
  deps: Pick<ToolServices, 'searchRecords'>,
  rt: ToolRuntime,
): Promise<CuratedSearchResult> {
  if (!userIdOrNull(rt.principal)) return EMPTY;
  const limit = Math.min(input.topK ?? 10, MAX_TOP_K);
  const res = await deps.searchRecords.search(
    DOCUMENTS_COLLECTION,
    { q: input.query ?? '', page: 1, limit },
    rt.principal,
  );
  return {
    collection: DOCUMENTS_COLLECTION,
    totalHits: res.totalHits,
    hits: res.hits.slice(0, limit),
    facets: res.facetDistribution,
  };
}

/** Mastra wrapper — not unit tested (imports @mastra). */
export function makeSearchDocumentsTool(services: ToolServices) {
  return createTool({
    id: 'search-documents',
    description:
      "Search the current user's uploaded documents (PDF/DOCX/Markdown) by full text and return the " +
      'top matching passages. Documents are indexed in chunks, so each hit is an excerpt carrying its ' +
      '`chunkIndex` and `fileId` — several hits may come from the same file. Read-only and automatically ' +
      'scoped to the current user. Pass an EMPTY query to list their documents. Use this to ground ' +
      'answers in files the user has attached or uploaded, and cite the file the passage came from.',
    inputSchema: searchDocumentsInput,
    outputSchema: z.object({
      collection: z.string(),
      totalHits: z.number(),
      hits: z.array(z.record(z.string(), z.unknown())),
      facets: z.record(z.string(), z.record(z.string(), z.number())).optional(),
    }),
    execute: async (input: SearchDocumentsInput, context: unknown) =>
      searchDocumentsExecute(input, services, readRuntime(context)),
  });
}
