/** One slice of a document's extracted text. */
export interface TextChunk {
  /** 0-based position in the document, so chunks can be ordered and cited. */
  index: number;
  text: string;
}

/**
 * Split extracted text into overlapping chunks on natural boundaries.
 *
 * Documents used to be stored whole: the full text went into one
 * `search_records.document` JSONB value and one Meili document, with no upper
 * bound. `FILE_MAX_SIZE` defaults to 50 MB, so a single upload could produce a
 * multi-megabyte row that was then copied again on every re-index and reload.
 * It also made retrieval poor — a whole book as one hit tells the agent very
 * little about *where* the answer is.
 *
 * Boundaries are preferred in order: paragraph break, then sentence end, then
 * whitespace, then a hard cut. `overlap` carries the tail of one chunk into the
 * next so a fact spanning a boundary is still findable from either side.
 */
export function chunkText(
  text: string,
  { size = 2_000, overlap }: { size?: number; overlap?: number } = {},
): TextChunk[] {
  if (size <= 0) throw new Error('chunk size must be positive');
  // Relative by default, so overriding `size` alone cannot produce an overlap
  // that is larger than the chunk it is supposed to overlap.
  const step = overlap ?? Math.floor(size * 0.1);
  if (step < 0 || step >= size) {
    throw new Error('overlap must be >= 0 and smaller than size');
  }

  const normalised = text.trim();
  if (normalised.length === 0) return [];
  if (normalised.length <= size) return [{ index: 0, text: normalised }];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalised.length) {
    const hardEnd = Math.min(start + size, normalised.length);
    const end =
      hardEnd === normalised.length
        ? hardEnd
        : findBoundary(normalised, start, hardEnd);
    const slice = normalised.slice(start, end).trim();
    if (slice.length > 0) chunks.push({ index: chunks.length, text: slice });
    if (end >= normalised.length) break;
    // Step forward by at least one character so a boundary that lands on the
    // window start cannot loop forever.
    start = Math.max(end - step, start + 1);
  }
  return chunks;
}

/**
 * Best split point in `[start, hardEnd)`, searching backwards from the end.
 * Only accepts a boundary in the last third of the window, so one long
 * paragraph does not produce a chunk a fraction of the requested size.
 */
function findBoundary(text: string, start: number, hardEnd: number): number {
  const floor = start + Math.floor((hardEnd - start) * 0.66);
  for (const pattern of ['\n\n', '. ', '\n', ' ']) {
    const at = text.lastIndexOf(pattern, hardEnd);
    if (at > floor) return at + pattern.length;
  }
  return hardEnd;
}
