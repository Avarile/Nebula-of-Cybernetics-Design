import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as mammoth from 'mammoth';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import {
  DOCX_MIME,
  MARKDOWN_MIME,
  PDF_MIME,
  PLAIN_TEXT_MIME,
  isIngestableDocMime,
} from './document-ingest.constants';

// pdf-parse ships no type declarations for this deep subpath (only for the bare
// package specifier, which `@types/pdf-parse` covers), and requiring the bare
// package index runs pdf-parse's own debug harness against a fixture file that
// isn't present outside its repo. `require()` + a manual cast avoids both, and
// keeps the exact module path the spec's `jest.mock` intercepts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  buffer: Buffer,
) => Promise<{ text: string; info?: { Title?: unknown } }>;

export interface ExtractedDocument {
  title?: string;
  text: string;
}

@Injectable()
export class DocumentExtractionService {
  constructor(private readonly errors: ExceptionService) {}

  async extract(
    mimeType: string,
    source: Readable | Buffer,
  ): Promise<ExtractedDocument> {
    if (!isIngestableDocMime(mimeType)) {
      throw this.errors.create(ErrorCode.FILE_MIME_NOT_ALLOWED, {
        message: `Unsupported document MIME "${mimeType}"`,
      });
    }
    const buffer = Buffer.isBuffer(source)
      ? source
      : await streamToBuffer(source);
    switch (mimeType) {
      case PDF_MIME: {
        const parsed = await pdfParse(buffer);
        return {
          text: parsed.text.trim(),
          // PDF metadata carries a title often enough to be worth reading; the
          // caller falls back to the filename when it is absent or blank.
          title: cleanTitle(parsed.info?.Title),
        };
      }
      case DOCX_MIME: {
        const { value } = await mammoth.extractRawText({ buffer });
        return { text: value.trim() };
      }
      case MARKDOWN_MIME:
      case PLAIN_TEXT_MIME:
      default:
        return { text: buffer.toString('utf8').trim() };
    }
  }
}

/** A metadata title is only useful if it is non-empty after trimming. */
function cleanTitle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
}

export async function streamToBuffer(src: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of src) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
