import { z } from 'zod';
import { brain } from '../brain.js';
import { archiveWebhook } from '../webhooks/archive.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type { ProcessedEmails, RawEmail, ChildrenEmailInfo, BillingEmailInfo } from './email-digest/types.js';
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
    'kickstarter', 'newsletters', 'marketing', 'notifications'
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

function buildCategorizationPrompt(email: RawEmail): string {
  return `I am Sean Fioritto. My wife is Beth Fioritto. Her most common email address is beth.lukes@gmail.com. The emails you are reading are from my inbox. My kids are Isaac and Ada.

  Categorize this email into exactly ONE category. Choose the BEST fit.

From: ${email.from}
Subject: ${email.subject}
Body: ${email.body}

Categories (pick ONE):
- children: Emails about MY kids, so Ada and Isaac (school, activities, camps, health, sports, choir, etc.)
- amazon: Amazon orders, shipping, deliveries, returns
- billing: Bills, receipts, invoices, subscriptions, bank statements, payment confirmations
- investments: Investment accounts, portfolio updates, dividends, trade confirmations
- kickstarter: Kickstarter, Indiegogo, crowdfunding updates
- newsletters: Newsletter subscriptions, periodic digests
- marketing: Marketing emails, promotions, sales, ads
- notifications: System notifications, product updates, policy changes, announcements
- Uncategorized: If it's not a great fit in any of the other categories, put it here.

Think about what this email is PRIMARILY about, then choose the single best category.`;
}

function buildChildrenEnrichmentPrompt(email: RawEmail): string {
  return `Analyze this email about children/kids activities.

From: ${email.from}
Subject: ${email.subject}
Body: ${email.body}

Provide:
1. A one-sentence summary of what this email is about
2. If there's an action item the parent needs to do (sign up, pay, respond, bring something, etc.), describe it. If no action needed, return null.`;
}

function buildBillingEnrichmentPrompt(email: RawEmail): string {
  return `Analyze this billing/payment email.

From: ${email.from}
Subject: ${email.subject}
Body: ${email.body.substring(0, 1500)}

Provide:
1. Brief description of what this bill or payment is for
2. The dollar amount if visible (e.g. "$49.99", "$125.00"). If no amount is visible, return null.`;
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

  .step('Fetch all inbox emails from all accounts', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();
    const emailsById: Record<string, RawEmail> = {};
    const query = 'label:inbox';

    for (const account of accounts) {
      const messages = await gmail.searchMessages(account.refreshToken, query, 100);

      for (const message of messages) {
        const details = await gmail.getMessageDetails(account.refreshToken, message.id);
        emailsById[message.id] = {
          id: message.id,
          subject: details.subject,
          from: details.from,
          date: details.date,
          body: details.body.substring(0, 2000),
          snippet: details.snippet,
          accountName: account.name,
          refreshToken: account.refreshToken,
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      ...state,
      emailsById,
      children: [] as string[],
      amazon: [] as string[],
      billing: [] as string[],
      investments: [] as string[],
      kickstarter: [] as string[],
      newsletters: [] as string[],
      marketing: [] as string[],
      notifications: [] as string[],
      childrenInfo: {} as Record<string, ChildrenEmailInfo>,
      billingInfo: {} as Record<string, BillingEmailInfo>,
    } as any;
  })

  .step('Categorize all emails', async ({ state, client }) => {
    const emailsById = state.emailsById as unknown as Record<string, RawEmail>;
    const emailEntries = Object.entries(emailsById);

    if (emailEntries.length === 0) {
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
    };

    const BATCH_SIZE = 20;

    for (let i = 0; i < emailEntries.length; i += BATCH_SIZE) {
      const batch = emailEntries.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async ([id, email], idx) => {
        await new Promise((resolve) => setTimeout(resolve, idx * 30));
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildCategorizationPrompt(email),
            schema: categorySchema,
            schemaName: 'emailCategory',
          })
        );
        return { id, category: result.category };
      });

      const results = await Promise.all(promises);

      for (const { id, category } of results) {
        if (categories[category]) {
          categories[category].push(id);
        }
      }
    }

    return {
      ...state,
      ...categories,
    } as any;
  })

  .step('Enrich children and billing emails', async ({ state, client }) => {
    const emailsById = state.emailsById as unknown as Record<string, RawEmail>;
    const childrenIds = state.children as unknown as string[];
    const billingIds = state.billing as unknown as string[];

    const childrenInfo: Record<string, ChildrenEmailInfo> = {};
    const billingInfo: Record<string, BillingEmailInfo> = {};

    // Enrich children emails
    for (const id of childrenIds) {
      const email = emailsById[id];
      if (!email) continue;

      const result = await withRetry(() =>
        client.generateObject({
          prompt: buildChildrenEnrichmentPrompt(email),
          schema: childrenEnrichmentSchema,
          schemaName: 'childrenEmailInfo',
        })
      );
      childrenInfo[id] = result;
    }

    // Enrich billing emails
    for (const id of billingIds) {
      const email = emailsById[id];
      if (!email) continue;

      const result = await withRetry(() =>
        client.generateObject({
          prompt: buildBillingEnrichmentPrompt(email),
          schema: billingEnrichmentSchema,
          schemaName: 'billingEmailInfo',
        })
      );
      billingInfo[id] = result;
    }

    return {
      ...state,
      childrenInfo,
      billingInfo,
    } as any;
  })

  .step('Generate unified summary page', async ({ state, pages, env }) => {
    const s = state as any;
    const processedData: ProcessedEmails = {
      emailsById: s.emailsById,
      children: s.children as string[],
      amazon: s.amazon as string[],
      billing: s.billing as string[],
      investments: s.investments as string[],
      kickstarter: s.kickstarter as string[],
      newsletters: s.newsletters as string[],
      marketing: s.marketing as string[],
      notifications: s.notifications as string[],
      childrenInfo: s.childrenInfo as Record<string, ChildrenEmailInfo>,
      billingInfo: s.billingInfo as Record<string, BillingEmailInfo>,
    };

    const totalEmails =
      processedData.children.length +
      processedData.amazon.length +
      processedData.billing.length +
      processedData.investments.length +
      processedData.kickstarter.length +
      processedData.newsletters.length +
      processedData.marketing.length +
      processedData.notifications.length;

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

    const counts = [
      children.length > 0 ? `${children.length} children` : null,
      amazon.length > 0 ? `${amazon.length} Amazon` : null,
      billing.length > 0 ? `${billing.length} billing` : null,
      investments.length > 0 ? `${investments.length} investments` : null,
      kickstarter.length > 0 ? `${kickstarter.length} Kickstarter` : null,
      newsletters.length > 0 ? `${newsletters.length} newsletters` : null,
      marketing.length > 0 ? `${marketing.length} marketing` : null,
      notifications.length > 0 ? `${notifications.length} notifications` : null,
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

  .step('Archive emails', async ({ state, response, gmail }) => {
    if (!(state as any).sessionId) {
      return { ...state, archived: false, archivedCount: 0 };
    }

    const webhookResponse = response as { emailIds: string[]; confirmed: boolean } | undefined;

    if (!webhookResponse?.confirmed) {
      return { ...state, archived: false, archivedCount: 0 };
    }

    const selectedEmailIds = new Set(webhookResponse.emailIds);
    const emailsById = (state as any).emailsById as Record<string, RawEmail>;

    const emailsByAccount: Record<string, { refreshToken: string; emailIds: string[] }> = {};

    for (const emailId of selectedEmailIds) {
      const email = emailsById[emailId];
      if (email) {
        const key = email.accountName;
        if (!emailsByAccount[key]) {
          emailsByAccount[key] = { refreshToken: email.refreshToken, emailIds: [] };
        }
        emailsByAccount[key].emailIds.push(emailId);
      }
    }

    let totalArchived = 0;
    for (const [, { refreshToken, emailIds }] of Object.entries(emailsByAccount)) {
      await gmail.archiveMessages(refreshToken, emailIds);
      totalArchived += emailIds.length;
    }

    return {
      ...state,
      archived: true,
      archivedCount: totalArchived,
    };
  });

export default emailDigestBrain;
