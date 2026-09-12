/**
 * Logic-less `{{ variable }}` substitution.
 *
 * Deliberately not a template language. Loops and conditionals living in a
 * database row are a code path with no tests, no review and no type checking,
 * and the first time one throws it does so inside a queue worker at 3am.
 * Anything that needs a decision is decided by the code that enqueues, and
 * passed in as a variable.
 */

/** `{{ name }}` or `{{name}}`; names are word characters and dots. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

export interface RenderResult {
  text: string;
  /** Placeholders with no value supplied — the caller decides how loudly to fail. */
  missing: string[];
}

/** Resolve `a.b.c` against a nested payload. */
function lookup(payload: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      payload,
    );
}

/**
 * Substitute placeholders, reporting any that had no value.
 *
 * A missing value renders as an empty string rather than leaving `{{ name }}`
 * in the output: a customer seeing raw template syntax is worse than a gap, and
 * `missing` gives the caller a way to catch it before sending.
 */
export function render(
  template: string,
  payload: Record<string, unknown>,
): RenderResult {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = lookup(payload, name);
    if (value === undefined || value === null) {
      missing.push(name);
      return '';
    }
    return String(value);
  });
  return { text, missing: [...new Set(missing)] };
}

/** Every placeholder a template references, in order of first appearance. */
export function placeholdersIn(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * Check a payload against a template's declared variables.
 *
 * Run when a template is saved AND when a notification is enqueued, so a
 * renamed field surfaces at save time rather than as a blank line in someone's
 * inbox.
 */
export function validatePayload(
  declared: Record<string, unknown>,
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const name of Object.keys(declared)) {
    const value = lookup(payload, name);
    if (value === undefined || value === null) {
      errors.push(`Missing template variable "${name}"`);
      continue;
    }
    const expected = declared[name];
    if (typeof expected === 'string' && expected !== 'any') {
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (actual !== expected) {
        errors.push(
          `Template variable "${name}" should be ${expected}, got ${actual}`,
        );
      }
    }
  }
  return errors;
}
