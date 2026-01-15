import { z } from 'zod';
import { brain } from '../brain.js';
import archiveWebhook from '../webhooks/archive.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type { ProcessedEmails, RawThread, ChildrenEmailInfo, BillingEmailInfo } from './email-digest/types.js';
import mercuryReceiptsBrain from './mercury-receipts.js';

// Helper for retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRateLimit = error?.message?.includes('429') ||
                          error?.message?.toLowerCase().includes('rate') ||
                          error?.message?.toLowerCase().includes('quota');

      if (!isRateLimit || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Schema for categorization - returns exactly ONE category
const categorySchema = z.object({
  category: z.enum([
    'children', 'amazon', 'billing', 'investments',
    'kickstarter', 'newsletters', 'marketing', 'notifications', 'npm'
  ]),
});

// Schema for children email enrichment
const childrenEnrichmentSchema = z.object({
  summary: z.string().describe('One sentence summary of what this email is about'),
  actionItem: z.string().nullable().describe('If there is something the parent needs to do, describe it briefly. Otherwise null.'),
});

// Schema for billing email enrichment
const billingEnrichmentSchema = z.object({
  description: z.string().describe('Brief description of what this bill/payment is for'),
  amount: z.string().nullable().describe('The dollar amount if visible in the email (e.g. "$49.99"). Otherwise null.'),
});

// Schema for NPM summary
const npmSummarySchema = z.object({
  summary: z.string().describe('Concise summary of packages published with their versions, e.g. "@positronic/shell: v0.0.50, v0.0.51; @positronic/core: v1.2.3"'),
});

function buildCategorizationPrompt(thread: RawThread): string {
  return `I am Sean Fioritto. My wife is Beth Fioritto. Her most common email address is beth.lukes@gmail.com. The emails you are reading are from my inbox. My kids are Isaac and Ada.

  Categorize this email into exactly ONE category. Choose the BEST fit.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Categories (pick ONE):
- children: Emails about MY kids, so Ada and Isaac (school, activities, camps, health, sports, choir, etc.)
- amazon: Amazon orders, shipping, deliveries, returns
- billing: Bills, receipts, invoices, subscriptions, bank statements, payment confirmations
- investments: Investment accounts, portfolio updates, dividends, trade confirmations
- kickstarter: Kickstarter, Indiegogo, crowdfunding updates
- newsletters: Newsletter subscriptions, periodic digests
- marketing: Marketing emails, promotions, sales, ads
- notifications: System notifications, product updates, policy changes, announcements. Notifications are of little value and should not be from clients, customers, friends, family, etc.
- npm: NPM package publish notifications from npmjs.com, npm registry emails
- Uncategorized: If it's not a great fit in any of the other categories, put it here.

Think about what this email is PRIMARILY about, then choose the single best category.`;
}

function buildChildrenEnrichmentPrompt(thread: RawThread): string {
  return `Analyze this email about children/kids activities.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. A one-sentence summary of what this email is about
2. If there's an action item the parent needs to do (sign up, pay, respond, bring something, etc.), describe it. If no action needed, return null.`;
}

function buildBillingEnrichmentPrompt(thread: RawThread): string {
  return `Analyze this billing/payment email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body.substring(0, 1500)}

Provide:
1. Brief description of what this bill or payment is for
2. The dollar amount if visible (e.g. "$49.99", "$125.00"). If no amount is visible, return null.`;
}

function buildNpmSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body.substring(0, 500)}`).join('\n\n---\n\n');
  return `Here are NPM package publish notifications. Summarize which packages were published and what versions.

Group by package name. If the same package has multiple versions published, list all versions together.
Format: "@scope/package: v1.0.0, v1.0.1; @scope/other: v2.0.0"

Keep it concise - just package names and versions, nothing else.

${threadBodies}`;
}

const emailDigestBrain = brain({
  title: 'email-digest',
  description: 'Categorizes inbox emails and extracts key info like action items and bill amounts',
})
  .brain(
    'Process Mercury receipt requests',
    mercuryReceiptsBrain,
    ({ state, brainState: { forwardedCount, archivedCount } }) => ({
      ...state,
      mercuryForwardedCount: forwardedCount ?? 0,
      mercuryArchivedCount: archivedCount ?? 0,
    }),
    () => ({})
  )

  .step('Fetch all inbox threads from all accounts', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();
    const threadsById: Record<string, RawThread> = {};
    const query = 'label:inbox';

    for (const account of accounts) {
      const threads = await gmail.searchThreads(account.refreshToken, query, 100);

      for (const thread of threads) {
        const details = await gmail.getThreadDetails(account.refreshToken, thread.threadId);
        threadsById[thread.threadId] = {
          threadId: thread.threadId,
          subject: details.subject,
          from: details.from,
          date: details.date,
          body: details.body.substring(0, 2000),
          snippet: details.snippet,
          messageCount: details.messageCount,
          messageIds: details.messageIds,
          accountName: account.name,
          refreshToken: account.refreshToken,
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      ...state,
      threadsById,
      children: [] as string[],
      amazon: [] as string[],
      billing: [] as string[],
      investments: [] as string[],
      kickstarter: [] as string[],
      newsletters: [] as string[],
      marketing: [] as string[],
      notifications: [] as string[],
      npm: [] as string[],
      childrenInfo: {} as Record<string, ChildrenEmailInfo>,
      billingInfo: {} as Record<string, BillingEmailInfo>,
      npmSummary: '' as string,
    } as any;
  })

  .step('Categorize all threads', async ({ state, client }) => {
    const threadsById = state.threadsById as unknown as Record<string, RawThread>;
    const threadEntries = Object.entries(threadsById);

    if (threadEntries.length === 0) {
      return state;
    }

    const categories: Record<string, string[]> = {
      children: [],
      amazon: [],
      billing: [],
      investments: [],
      kickstarter: [],
      newsletters: [],
      marketing: [],
      notifications: [],
      npm: [],
    };

    const BATCH_SIZE = 20;

    for (let i = 0; i < threadEntries.length; i += BATCH_SIZE) {
      const batch = threadEntries.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async ([threadId, thread], idx) => {
        await new Promise((resolve) => setTimeout(resolve, idx * 30));
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildCategorizationPrompt(thread),
            schema: categorySchema,
            schemaName: 'emailCategory',
          })
        );
        return { threadId, category: result.category };
      });

      const results = await Promise.all(promises);

      for (const { threadId, category } of results) {
        if (categories[category]) {
          categories[category].push(threadId);
        }
      }
    }

    return {
      ...state,
      ...categories,
    } as any;
  })

  .step('Enrich children, billing, and npm threads', async ({ state, client }) => {
    const threadsById = state.threadsById as unknown as Record<string, RawThread>;
    const childrenIds = state.children as unknown as string[];
    const billingIds = state.billing as unknown as string[];
    const npmIds = state.npm as unknown as string[];

    const childrenInfo: Record<string, ChildrenEmailInfo> = {};
    const billingInfo: Record<string, BillingEmailInfo> = {};
    let npmSummary = '';

    // Enrich children threads
    for (const threadId of childrenIds) {
      const thread = threadsById[threadId];
      if (!thread) continue;

      const result = await withRetry(() =>
        client.generateObject({
          prompt: buildChildrenEnrichmentPrompt(thread),
          schema: childrenEnrichmentSchema,
          schemaName: 'childrenEmailInfo',
        })
      );
      childrenInfo[threadId] = result;
    }

    // Enrich billing threads
    for (const threadId of billingIds) {
      const thread = threadsById[threadId];
      if (!thread) continue;

      const result = await withRetry(() =>
        client.generateObject({
          prompt: buildBillingEnrichmentPrompt(thread),
          schema: billingEnrichmentSchema,
          schemaName: 'billingEmailInfo',
        })
      );
      billingInfo[threadId] = result;
    }

    // Generate npm summary
    if (npmIds.length > 0) {
      const npmThreads = npmIds.map(threadId => threadsById[threadId]).filter(Boolean);
      const result = await withRetry(() =>
        client.generateObject({
          prompt: buildNpmSummaryPrompt(npmThreads),
          schema: npmSummarySchema,
          schemaName: 'npmSummary',
        })
      );
      npmSummary = result.summary;
    }

    return {
      ...state,
      childrenInfo,
      billingInfo,
      npmSummary,
    } as any;
  })

  .step('Generate unified summary page', async ({ state, pages, env }) => {
    const s = state as any;
    const processedData: ProcessedEmails = {
      threadsById: s.threadsById,
      children: s.children as string[],
      amazon: s.amazon as string[],
      billing: s.billing as string[],
      investments: s.investments as string[],
      kickstarter: s.kickstarter as string[],
      newsletters: s.newsletters as string[],
      marketing: s.marketing as string[],
      notifications: s.notifications as string[],
      npm: s.npm as string[],
      childrenInfo: s.childrenInfo as Record<string, ChildrenEmailInfo>,
      billingInfo: s.billingInfo as Record<string, BillingEmailInfo>,
      npmSummary: s.npmSummary as string,
    };

    const totalEmails =
      processedData.children.length +
      processedData.amazon.length +
      processedData.billing.length +
      processedData.investments.length +
      processedData.kickstarter.length +
      processedData.newsletters.length +
      processedData.marketing.length +
      processedData.notifications.length +
      processedData.npm.length;

    if (totalEmails === 0) {
      return { ...state, sessionId: '', pageUrl: '' };
    }

    if (!pages) {
      throw new Error('Pages service not available');
    }

    const sessionId = crypto.randomUUID();
    const slug = `email-digest-${sessionId.slice(0, 8)}`;

    const tempHtml = '<html><body>Loading...</body></html>';
    await pages.create(slug, tempHtml, { persist: false });

    const webhookUrl = `${env.origin}/webhooks/archive`;

    const html = generateUnifiedPage(processedData, sessionId, webhookUrl);
    await pages.update(slug, html);

    return { ...state, sessionId, pageUrl: `${env.origin}/pages/${slug}` } as any;
  })

  .step('Send notification', async ({ state, ntfy }) => {
    if (!(state as any).pageUrl) {
      return state;
    }

    const children = (state as any).children as string[];
    const amazon = (state as any).amazon as string[];
    const billing = (state as any).billing as string[];
    const investments = (state as any).investments as string[];
    const kickstarter = (state as any).kickstarter as string[];
    const newsletters = (state as any).newsletters as string[];
    const marketing = (state as any).marketing as string[];
    const notifications = (state as any).notifications as string[];
    const npm = (state as any).npm as string[];

    const counts = [
      children.length > 0 ? `${children.length} children` : null,
      amazon.length > 0 ? `${amazon.length} Amazon` : null,
      billing.length > 0 ? `${billing.length} billing` : null,
      investments.length > 0 ? `${investments.length} investments` : null,
      kickstarter.length > 0 ? `${kickstarter.length} Kickstarter` : null,
      newsletters.length > 0 ? `${newsletters.length} newsletters` : null,
      marketing.length > 0 ? `${marketing.length} marketing` : null,
      notifications.length > 0 ? `${notifications.length} notifications` : null,
      npm.length > 0 ? `${npm.length} npm` : null,
    ].filter(Boolean);

    const message = `Email digest: ${counts.join(', ')}`;
    await ntfy.send(message, (state as any).pageUrl as string);

    return state;
  })

  .step('Wait for archive confirmation', ({ state }) => {
    if (!(state as any).sessionId) {
      return state;
    }

    const sessionId = (state as any).sessionId as string;
    const webhook = archiveWebhook(sessionId);

    return {
      state,
      waitFor: [webhook],
    };
  })

  .step('Archive threads', async ({ state, response, gmail }) => {
    if (!(state as any).sessionId) {
      return { ...state, archived: false, archivedCount: 0 };
    }

    const webhookResponse = response as { threadIds: string[]; confirmed: boolean } | undefined;

    if (!webhookResponse?.confirmed) {
      return { ...state, archived: false, archivedCount: 0 };
    }

    const selectedThreadIds = new Set(webhookResponse.threadIds);
    const threadsById = (state as any).threadsById as Record<string, RawThread>;

    // Group all message IDs by account for archiving
    const messagesByAccount: Record<string, { refreshToken: string; messageIds: string[] }> = {};

    for (const threadId of selectedThreadIds) {
      const thread = threadsById[threadId];
      if (thread) {
        const key = thread.accountName;
        if (!messagesByAccount[key]) {
          messagesByAccount[key] = { refreshToken: thread.refreshToken, messageIds: [] };
        }
        // Add all message IDs from this thread
        messagesByAccount[key].messageIds.push(...thread.messageIds);
      }
    }

    let totalArchived = 0;
    for (const [, { refreshToken, messageIds }] of Object.entries(messagesByAccount)) {
      await gmail.archiveMessages(refreshToken, messageIds);
      totalArchived += messageIds.length;
    }

    return {
      ...state,
      archived: true,
      archivedCount: totalArchived,
    };
  });

export default emailDigestBrain;
