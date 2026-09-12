import type { ApiClient } from './client';

/**
 * Every id the suite creates, threaded from the suite that creates it to the
 * ones that consume it.
 *
 * This is deliberately one flat bag rather than per-suite returns: the data
 * graph is genuinely cross-cutting (an invoice bills time logged on a task
 * belonging to a project linked to a contact), and a shared registry keeps the
 * dependency explicit at the point of use instead of in a chain of signatures.
 */
export interface Ctx {
  client: ApiClient;
  baseUrl: string;
  /** Unique run marker; every created record carries it so runs never collide. */
  stamp: string;

  ids: {
    // identity
    mockUserId?: string;
    secondUserId?: string;
    serviceCredentialId?: string;
    serviceApiKey?: string;

    // shared foundations
    tagContactId?: string;
    tagProjectId?: string;
    tagTaskId?: string;
    tagKnowledgeId?: string;
    fileId?: string;
    attachmentId?: string;
    commentId?: string;
    replyCommentId?: string;

    // crm
    companyId?: string;
    contactId?: string;
    contactTwoId?: string;
    contactTypeId?: string;
    contactCategoryId?: string;
    channelId?: string;
    relationshipId?: string;
    interactionId?: string;

    // knowledge
    knowledgeId?: string;
    knowledgeTypeId?: string;
    knowledgeCategoryId?: string;
    knowledgeGrantId?: string;
    knowledgeContactLinkId?: string;

    // projects
    projectId?: string;
    milestoneId?: string;
    goalId?: string;
    taskId?: string;
    blockerTaskId?: string;
    dependencyId?: string;
    timeEntryId?: string;
    projectContactLinkId?: string;
    projectKnowledgeLinkId?: string;

    // finance
    accountId?: string;
    counterAccountId?: string;
    transactionId?: string;
    reversibleTransactionId?: string;
    budgetId?: string;
    recurringId?: string;
    invoiceId?: string;
    invoiceLineId?: string;
    voidInvoiceId?: string;
    expenseCategoryId?: string;
    incomeCategoryId?: string;

    // system
    smtpId?: string;
    imapId?: string;
    integrationId?: string;
    settingKey?: string;
    featureFlagKey?: string;
    suppressionEmail?: string;
    templateKey?: string;

    // search
    collectionName?: string;
    recordId?: string;
    recordExternalId?: string;

    // agent
    scheduleId?: string;
    conversationId?: string;
  };

  /** Facts discovered at runtime that later assertions depend on. */
  facts: {
    adminUserId?: string;
    agentToken?: string;
    currency?: string;
    notificationEventKey?: string;
    retentionEntityType?: string;
  };
}

export function createContext(client: ApiClient, baseUrl: string): Ctx {
  return {
    client,
    baseUrl,
    stamp: `${Date.now()}`,
    ids: {},
    facts: {},
  };
}

/** Today, and an offset in days, as `YYYY-MM-DD` — the format every date DTO wants. */
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
