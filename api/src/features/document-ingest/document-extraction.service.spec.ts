import { Readable } from 'node:stream';
import { DocumentExtractionService } from './document-extraction.service';
import {
  DOCX_MIME,
  MARKDOWN_MIME,
  PDF_MIME,
  PLAIN_TEXT_MIME,
} from './document-ingest.constants';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'DOCX TEXT' }),
}));
jest.mock('pdf-parse/lib/pdf-parse.js', () =>
  jest.fn().mockResolvedValue({ text: 'PDF TEXT' }),
);

describe('DocumentExtractionService', () => {
  const errors = {
    create: (_c: unknown, o?: { message?: string }) =>
      new Error(o?.message ?? 'err'),
  };
  const svc = new DocumentExtractionService(errors as never);

  it('extracts plain text and markdown verbatim from a buffer', async () => {
    const md = await svc.extract(MARKDOWN_MIME, Buffer.from('# Title\nbody'));
    expect(md.text).toContain('body');
    const txt = await svc.extract(PLAIN_TEXT_MIME, Buffer.from('hello world'));
    expect(txt.text).toBe('hello world');
  });

  it('extracts text from a Readable stream via streamToBuffer', async () => {
    const stream = Readable.from(Buffer.from('hello from a stream'));
    const result = await svc.extract(PLAIN_TEXT_MIME, stream);
    expect(result.text).toBe('hello from a stream');
  });

  it('extracts docx via mammoth and pdf via pdf-parse', async () => {
    expect((await svc.extract(DOCX_MIME, Buffer.from('x'))).text).toBe(
      'DOCX TEXT',
    );
    expect((await svc.extract(PDF_MIME, Buffer.from('x'))).text).toBe(
      'PDF TEXT',
    );
  });

  it('throws on an unsupported MIME type', async () => {
    await expect(
      svc.extract('image/png', Buffer.from('x')),
    ).rejects.toBeInstanceOf(Error);
  });
});
