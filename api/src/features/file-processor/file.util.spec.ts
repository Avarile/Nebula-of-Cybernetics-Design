import {
  contentAddressedKey,
  detectMimeFromMagic,
  isDeclaredMimeMismatch,
  isMimeAllowed,
  randomObjectKey,
} from './file.util';

describe('file.util', () => {
  describe('contentAddressedKey', () => {
    it('shards by the first two byte-pairs and lowercases', () => {
      const hash = 'AB'.repeat(32); // 64 hex chars
      expect(contentAddressedKey(hash)).toBe(`sha256/ab/ab/${'ab'.repeat(32)}`);
    });
  });

  describe('randomObjectKey', () => {
    it('is unique and prefixed with uploads/', () => {
      const a = randomObjectKey();
      const b = randomObjectKey();
      expect(a).toMatch(/^uploads\/[0-9a-f-]{36}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('isMimeAllowed', () => {
    it('allows any type when the allowlist is empty', () => {
      expect(isMimeAllowed('application/x-anything', [])).toBe(true);
    });
    it('enforces the allowlist when set', () => {
      expect(isMimeAllowed('image/png', ['image/png'])).toBe(true);
      expect(isMimeAllowed('image/gif', ['image/png'])).toBe(false);
    });
  });

  describe('detectMimeFromMagic', () => {
    it('detects PNG', () => {
      expect(detectMimeFromMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(
        'image/png',
      );
    });
    it('detects PDF', () => {
      expect(detectMimeFromMagic(Buffer.from('%PDF-1.7'))).toBe(
        'application/pdf',
      );
    });
    it('detects JPEG', () => {
      expect(detectMimeFromMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
        'image/jpeg',
      );
    });
    it('returns null for unknown signatures', () => {
      expect(
        detectMimeFromMagic(Buffer.from([0x00, 0x01, 0x02, 0x03])),
      ).toBeNull();
    });
  });

  describe('isDeclaredMimeMismatch', () => {
    it('flags a declared png that is actually a pdf', () => {
      expect(isDeclaredMimeMismatch('image/png', Buffer.from('%PDF-1.7'))).toBe(
        true,
      );
    });
    it('accepts a matching declaration', () => {
      expect(
        isDeclaredMimeMismatch(
          'image/png',
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        ),
      ).toBe(false);
    });
    it('does not flag unknown signatures', () => {
      expect(
        isDeclaredMimeMismatch(
          'image/png',
          Buffer.from([0x00, 0x01, 0x02, 0x03]),
        ),
      ).toBe(false);
    });
    it('treats OOXML (docx) as compatible with a zip signature', () => {
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      expect(
        isDeclaredMimeMismatch(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          zip,
        ),
      ).toBe(false);
    });
  });
});

describe('detectMimeFromMagic — broadened coverage', () => {
  const buf = (s: string) => Buffer.from(s, 'utf8');

  it.each([
    ['%PDF-1.7', 'application/pdf'],
    ['<?xml version="1.0"?>', 'application/xml'],
    ['<svg xmlns="...">', 'image/svg+xml'],
    ['<!DOCTYPE html><html>', 'text/html'],
    ['<html><body>', 'text/html'],
    ['<script>alert(1)</script>', 'text/html'],
    ['#!/bin/sh', 'text/x-shellscript'],
  ])('detects %s', (content, expected) => {
    expect(detectMimeFromMagic(buf(content))).toBe(expected);
  });

  it('tolerates a BOM and leading whitespace before markup', () => {
    expect(detectMimeFromMagic(buf('﻿\n  <!DOCTYPE html>'))).toBe('text/html');
  });

  it('returns null for genuinely unrecognised bytes', () => {
    expect(
      detectMimeFromMagic(Buffer.from([0x01, 0x02, 0x03, 0x04])),
    ).toBeNull();
  });

  it('prefers a binary signature over markup sniffing', () => {
    // A PNG whose bytes happen to contain '<' later must not read as markup.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      buf('<html>'),
    ]);
    expect(detectMimeFromMagic(png)).toBe('image/png');
  });
});

describe('isDeclaredMimeMismatch — broadened coverage', () => {
  const buf = (s: string) => Buffer.from(s, 'utf8');

  // The gap that mattered: text-ish payloads declared as text/plain went
  // through unquarantined, and document-ingest then parses those bytes.
  it('flags HTML declared as text/plain', () => {
    expect(isDeclaredMimeMismatch('text/plain', buf('<!DOCTYPE html>'))).toBe(
      true,
    );
  });

  it('flags a shell script declared as text/markdown', () => {
    expect(isDeclaredMimeMismatch('text/markdown', buf('#!/bin/sh'))).toBe(
      true,
    );
  });

  it('accepts SVG declared as image/svg+xml', () => {
    expect(isDeclaredMimeMismatch('image/svg+xml', buf('<svg>'))).toBe(false);
  });

  it('accepts an XML payload declared as a +xml type', () => {
    expect(
      isDeclaredMimeMismatch(
        'application/rss+xml',
        buf('<?xml version="1.0"?>'),
      ),
    ).toBe(false);
  });

  it('still accepts DOCX declared as its OOXML type', () => {
    expect(
      isDeclaredMimeMismatch(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      ),
    ).toBe(false);
  });

  it('does not flag plain prose declared as text/plain', () => {
    expect(isDeclaredMimeMismatch('text/plain', buf('Just some notes.'))).toBe(
      false,
    );
  });
});
