/**
 * How many of each thing to create.
 *
 * Tiered rather than uniform: a vocabulary with 200 entries is noise, and 3
 * contacts will not exercise a paginated list. Core entities carry hundreds so
 * pagination, filtering and access-scoping are tested against a corpus that
 * behaves like a real one; reference and configuration tables carry enough
 * variety to cover their enums and no more.
 *
 * `admin` and `user` split each core entity between the two principals, so
 * every ownership-scoped read path has both "mine" and "someone else's" rows to
 * distinguish. The non-admin's share is bounded by what the `user` role may
 * actually create — it cannot open projects or touch the ledger, so those are
 * admin-only by necessity rather than by choice.
 */
export interface Split {
  admin: number;
  user: number;
}

export const VOLUME = {
  // ---------------------------------------------------------- foundations
  tags: 40,
  contactTypes: 10,
  contactCategories: 12,
  knowledgeTypes: 10,
  knowledgeCategories: 12,
  files: 30,
  extraUsers: 12,
  permissionOverrides: 10,
  preferences: 10,

  // ----------------------------------------------------------------- crm
  companies: { admin: 35, user: 25 } as Split,
  contacts: { admin: 120, user: 100 } as Split,
  channels: 120,
  interactions: 180,
  relationships: 80,

  // ----------------------------------------------------------- knowledge
  knowledge: { admin: 80, user: 60 } as Split,
  knowledgeGrants: 60,
  knowledgeContactLinks: 60,

  // ------------------------------------------------------------ projects
  projects: 30,
  projectMembers: 60,
  milestones: 60,
  goals: 60,
  tasks: { admin: 130, user: 130 } as Split,
  taskDependencies: 60,
  taskWatchers: 60,
  timeEntries: 180,
  projectContactLinks: 40,
  projectKnowledgeLinks: 40,

  // ------------------------------------------------------------- finance
  accounts: 20,
  transactions: 220,
  budgets: 25,
  recurring: 25,
  fxRates: 40,
  invoices: 35,
  invoiceLines: 90,
  payments: 45,

  // -------------------------------------------------------------- system
  settings: 20,
  featureFlags: 20,
  smtpConfigs: 8,
  imapConfigs: 8,
  integrations: 12,
  suppressions: 15,
  templates: 8,

  // -------------------------------------------------------------- search
  collections: 8,
  searchRecords: 150,

  // -------------------------------------------------------------- collab
  comments: 140,
  attachments: 60,
} as const;

/**
 * Scale every count by `DATA_GEN_SCALE` (a fraction, default 1).
 *
 * Exists so a payload change can be smoke-tested against the real API in a
 * minute rather than half an hour — the shape of the corpus is identical, only
 * its size changes. Every count floors at 1, so no entity silently drops out
 * of a scaled run and hides a broken payload.
 */
export function scaled(n: number): number {
  const factor = Number(process.env.DATA_GEN_SCALE ?? 1);
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) return n;
  return Math.max(1, Math.round(n * factor));
}

/** Total create calls, used to print an honest ETA before the run starts. */
export function plannedRequests(): number {
  let total = 0;
  for (const value of Object.values(VOLUME)) {
    if (typeof value === 'number') total += scaled(value);
    else total += scaled(value.admin) + scaled(value.user);
  }
  // Files and extra users cost a second call each (complete, role grant).
  return total + scaled(VOLUME.files) + scaled(VOLUME.extraUsers);
}
