import { randomUUID } from 'node:crypto';

/** Content-addressed object key: `sha256/ab/cd/<full-hash>` (sharded prefix). */
export function contentAddressedKey(sha256: string): string {
  const hash = sha256.toLowerCase();
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

/** Random object key for uploads whose checksum is not known up front. */
export function randomObjectKey(): string {
  return `uploads/${randomUUID()}`;
}

/** True when the MIME type is permitted (empty allowlist = allow any). */
export function isMimeAllowed(
  mimeType: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.length === 0 || allowlist.includes(mimeType);
}

/**
 * Byte signatures we can positively identify, longest-prefix first.
 *
 * `null` from the sniffer means "unrecognised", which the quarantine gate
 * treats as "not a mismatch" — so every signature missing from this table is a
 * type that can be declared as anything and pass. The dangerous gap was
 * text-ish payloads: HTML, SVG and scripts declared as `text/plain` sailed
 * through, and `document-ingest` then parses those bytes.
 */
const SIGNATURES: ReadonlyArray<{ magic: number[]; mime: string }> = [
  { magic: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' }, // %PDF
  { magic: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { magic: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' }, // GIF8
  { magic: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip' }, // PK.. (also OOXML)
  { magic: [0x50, 0x4b, 0x05, 0x06], mime: 'application/zip' }, // empty archive
  { magic: [0x50, 0x4b, 0x07, 0x08], mime: 'application/zip' }, // spanned archive
  { magic: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { magic: [0x1f, 0x8b], mime: 'application/gzip' },
  { magic: [0x42, 0x4d], mime: 'image/bmp' },
  { magic: [0x25, 0x21, 0x50, 0x53], mime: 'application/postscript' }, // %!PS
  { magic: [0x7f, 0x45, 0x4c, 0x46], mime: 'application/x-elf' },
  { magic: [0x4d, 0x5a], mime: 'application/x-msdownload' }, // MZ (PE)
  { magic: [0xca, 0xfe, 0xba, 0xbe], mime: 'application/java-vm' },
];

/** Leading bytes that identify markup even though it has no binary signature. */
const TEXT_SIGNATURES: ReadonlyArray<{ prefix: string; mime: string }> = [
  { prefix: '<?xml', mime: 'application/xml' },
  { prefix: '<svg', mime: 'image/svg+xml' },
  { prefix: '<!doctype html', mime: 'text/html' },
  { prefix: '<html', mime: 'text/html' },
  { prefix: '<script', mime: 'text/html' },
  { prefix: '#!', mime: 'text/x-shellscript' },
];

function startsWith(head: Buffer, magic: number[]): boolean {
  if (head.length < magic.length) return false;
  return magic.every((byte, i) => head[i] === byte);
}

/**
 * Magic-byte MIME sniffer. Returns the detected MIME type, or `null` when the
 * signature is unrecognised (unknown ≠ mismatch).
 */
export function detectMimeFromMagic(head: Buffer): string | null {
  for (const { magic, mime } of SIGNATURES) {
    if (startsWith(head, magic)) return mime;
  }
  // Markup sniffing, after the binary table so a binary format that happens to
  // begin with '<' is never misread. Leading whitespace and a BOM are skipped
  // because both are common and neither changes what the payload is.
  const text = head
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  for (const { prefix, mime } of TEXT_SIGNATURES) {
    if (text.startsWith(prefix)) return mime;
  }
  return null;
}

/** Zip-based container formats that legitimately present a ZIP signature. */
function isZipFamily(mime: string): boolean {
  return (
    mime === 'application/zip' ||
    mime.startsWith('application/vnd.openxmlformats-officedocument') ||
    mime.startsWith('application/vnd.oasis.opendocument') ||
    mime === 'application/epub+zip' ||
    mime === 'application/java-archive'
  );
}

/**
 * Conclusive only for signatures we recognise: returns `true` only when we
 * positively detect a type that contradicts the declared MIME type.
 */
export function isDeclaredMimeMismatch(
  declared: string,
  head: Buffer,
): boolean {
  const detected = detectMimeFromMagic(head);
  if (detected === null) return false; // unknown signature — not a mismatch
  if (detected === declared) return false;
  if (detected === 'application/zip' && isZipFamily(declared)) return false;
  // XML is a supertype of several declared types we accept as-is.
  if (detected === 'application/xml' && isXmlFamily(declared)) return false;
  return true;
}

/** Declared types whose payload legitimately begins with an XML declaration. */
function isXmlFamily(mime: string): boolean {
  return (
    mime === 'application/xml' ||
    mime === 'text/xml' ||
    mime === 'image/svg+xml' ||
    mime.endsWith('+xml')
  );
}
