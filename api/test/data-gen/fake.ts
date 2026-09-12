/**
 * Deterministic pseudo-data.
 *
 * Seeded rather than random on purpose: a generation run that fails at record
 * 1,847 should be reproducible, and `Math.random` turns "it created a bad
 * payload" into a story nobody can retell. Every value is derived from an
 * index, so the same run number always produces the same corpus.
 */

/** Mulberry32 — small, fast, and good enough for names and amounts. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(list: readonly T[], i: number): T {
  return list[i % list.length];
}

const FIRST = [
  'Ada',
  'Grace',
  'Alan',
  'Edsger',
  'Barbara',
  'Ken',
  'Dennis',
  'Margaret',
  'Linus',
  'Katherine',
  'Donald',
  'Frances',
  'Tim',
  'Radia',
  'Vint',
  'Anita',
  'Leslie',
  'Shafi',
  'Robert',
  'Karen',
];
const LAST = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Dijkstra',
  'Liskov',
  'Thompson',
  'Ritchie',
  'Hamilton',
  'Torvalds',
  'Johnson',
  'Knuth',
  'Allen',
  'Berners-Lee',
  'Perlman',
  'Cerf',
  'Borg',
  'Lamport',
  'Goldwasser',
  'Kahn',
  'Spärck Jones',
];
const COMPANY_HEAD = [
  'Northwind',
  'Meridian',
  'Halcyon',
  'Ironwood',
  'Bluegrass',
  'Kestrel',
  'Lantern',
  'Quarry',
  'Saltmarsh',
  'Thornfield',
  'Vantage',
  'Wexford',
];
const COMPANY_TAIL = [
  'Analytics',
  'Logistics',
  'Systems',
  'Partners',
  'Holdings',
  'Foundry',
  'Labs',
  'Group',
  'Industries',
  'Collective',
];
const INDUSTRIES = [
  'Software',
  'Logistics',
  'Healthcare',
  'Education',
  'Manufacturing',
  'Renewables',
  'Finance',
  'Agriculture',
  'Media',
  'Construction',
];
const TOPICS = [
  'onboarding',
  'incident response',
  'data retention',
  'billing rules',
  'deployment',
  'access review',
  'capacity planning',
  'vendor assessment',
  'disaster recovery',
  'schema migration',
  'cost allocation',
  'observability',
];
const VERBS = [
  'Draft',
  'Review',
  'Migrate',
  'Audit',
  'Refactor',
  'Document',
  'Automate',
  'Investigate',
  'Reconcile',
  'Decommission',
];

export const first = (i: number) => pick(FIRST, i);
export const last = (i: number) => pick(LAST, i * 7 + 3);
export const fullName = (i: number) => `${first(i)} ${last(i)}`;
export const topic = (i: number) => pick(TOPICS, i);
export const industry = (i: number) => pick(INDUSTRIES, i);

export const companyName = (i: number) =>
  `${pick(COMPANY_HEAD, i)} ${pick(COMPANY_TAIL, i * 5 + 1)}`;

export const taskTitle = (i: number) =>
  `${pick(VERBS, i)} the ${topic(i * 3 + 1)} runbook`;

export const knowledgeTitle = (i: number) =>
  `${pick(VERBS, i * 2)} notes on ${topic(i)}`;

export function paragraph(i: number, sentences = 3): string {
  const r = rng(i + 991);
  const out: string[] = [];
  for (let n = 0; n < sentences; n += 1) {
    out.push(
      `The ${topic(i + n)} process was reviewed on cycle ${((i + n) % 12) + 1} ` +
        `and ${r() > 0.5 ? 'accepted' : 'deferred pending evidence'}.`,
    );
  }
  return out.join(' ');
}

/** An email that is unique per run and obviously synthetic. */
export const email = (i: number, stamp: string) =>
  `${first(i).toLowerCase()}.${last(i)
    .toLowerCase()
    .replace(/[^a-z]/g, '')}.${i}.${stamp}@cybernetics.test`;

/** `YYYY-MM-DD`, offset from today. */
export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function isoDateTime(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
}

/** A decimal string with exactly `dp` places — every money DTO wants a string. */
export function money(value: number, dp = 4): string {
  return value.toFixed(dp);
}

/** An UPPER_SNAKE project key, unique within a run. */
export function projectKey(i: number, stamp: string): string {
  const head = pick(COMPANY_HEAD, i)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return `${head.slice(0, 6)}${stamp.slice(-4)}${i}`.slice(0, 20);
}

/** A lowercase-with-dashes slug fragment, unique per index. */
export function slug(prefix: string, i: number, stamp: string): string {
  return `${prefix}-${topic(i).replace(/\s+/g, '-')}-${i}-${stamp}`.toLowerCase();
}
