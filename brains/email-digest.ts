import { z } from 'zod';
import { brain } from '../brain.js';
import archiveWebhook from '../webhooks/archive.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type { ProcessedEmails, RawThread, ChildrenEmailInfo, BillingEmailInfo, ReceiptsEmailInfo, NewsletterEmailInfo, FinancialEmailInfo } from './email-digest/types.js';
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
    'skip', 'children', 'amazon', 'billing', 'receipts', 'investments',
    'kickstarter', 'newsletters', 'marketing', 'notifications', 'npm',
    'security-alerts', 'confirmation-codes', 'reminders',
    'financial-notifications', 'shipping'
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
  amount: z.string().describe('The dollar amount owed (e.g. "$544.02", "$99.00"). Extract from Statement Balance, Amount Due, Total Due, or any visible dollar amount. If no amount found, return empty string.'),
});

// Schema for receipts email enrichment
const receiptLineItemSchema = z.object({
  item: z.string().describe('Name or description of the item purchased'),
  amount: z.string().nullable().describe('The dollar amount for this item (e.g. "$49.99"). Otherwise null.'),
});

const receiptsEnrichmentSchema = z.object({
  description: z.string().describe('Brief description of what was purchased/paid (merchant name or service)'),
  totalAmount: z.string().nullable().describe('The total dollar amount paid (e.g. "$49.99"). Otherwise null.'),
  lineItems: z.array(receiptLineItemSchema).describe('Individual items purchased. If no itemized list is visible, return an empty array.'),
});

// Schema for newsletter email enrichment
const newsletterEnrichmentSchema = z.object({
  webLink: z.string().nullish().describe('The URL to view this newsletter in a web browser. Look for links like "View in browser", "Read online", "View this email in your browser", "Click here to read online". If no such link exists, return null.'),
  unsubscribeLink: z.string().nullish().describe('The URL to unsubscribe from this newsletter. Look for links containing "unsubscribe", "opt out", "manage preferences", "email preferences", "subscription preferences". If no such link exists, return null.'),
});

// Schema for NPM summary
const npmSummarySchema = z.object({
  summary: z.string().describe('Concise summary of packages published with their versions, e.g. "@positronic/shell: v0.0.50, v0.0.51; @positronic/core: v1.2.3"'),
});

// Schema for security alerts summary
const securityAlertsSummarySchema = z.object({
  summary: z.string().describe('Summary of security alerts grouped by service and type, e.g. "Google: 2 sign-ins (Chicago, NYC); Apple: new device added"'),
});

// Schema for confirmation codes summary
const confirmationCodesSummarySchema = z.object({
  summary: z.string().describe('Summary of confirmation codes grouped by service with the code if visible, e.g. "GitHub: 123456; Slack: 789012; Gmail: verification link"'),
});

// Schema for reminders summary
const remindersSummarySchema = z.object({
  summary: z.string().describe('Summary of upcoming events/reminders grouped by date or type, e.g. "Today: dentist 2pm, team sync 4pm; Tomorrow: flight to NYC"'),
});

// Schema for financial email enrichment
const financialEnrichmentSchema = z.object({
  description: z.string().describe('Brief description of what this financial notification is about'),
  amount: z.string().nullable().describe('The dollar amount if visible (e.g. "$49.99", "$1,234.56"). Otherwise null.'),
});

// Schema for financial notifications summary
const financialSummarySchema = z.object({
  summary: z.string().describe('Summary of financial notifications grouped by service, e.g. "Venmo: December transaction history; UHC: EOB available; Schwab: QQQ dividend"'),
});

// Schema for shipping notifications summary
const shippingSummarySchema = z.object({
  summary: z.string().describe('Summary of shipping updates grouped by sender, e.g. "Apple: AirPods shipped, arriving Jan 18; Amazon: package delivered"'),
});

function buildCategorizationPrompt(thread: RawThread): string {
  return `I am Sean Fioritto. My wife is Beth Fioritto. Her most common email address is beth.lukes@gmail.com. The emails you are reading are from my inbox. My kids are Isaac and Ada. My sister is Mia Fioritto Rubin.

Categorize this email into exactly ONE category. Choose the BEST fit.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

STEP 1 - CHECK IF THIS IS A NEWSLETTER OR MASS EMAIL:
Look at the email body content carefully. Is this a newsletter? Signs of a newsletter:
- Has unsubscribe link or "manage preferences" link
- Sent to many people (not addressed to me personally in the body)
- Formatted like a publication (headers, sections, multiple topics)
- From a mailing list or uses marketing email infrastructure
- Content is general/broadcast, not specific to me personally

If it's a newsletter, it goes in "newsletters" (or "children" if about kids activities) - NOT skip.

STEP 2 - IF NOT A NEWSLETTER, CHECK FOR SKIP:
Only use "skip" for emails that are TRULY personal correspondence, important official notices, or calendar invitations:
- ALWAYS skip emails from reminder@superhuman.com (these are snoozed emails I intentionally want to see)
- ALWAYS skip calendar invitations (subject starts with "Invitation:" or contains .ics attachments, meeting invites from Google Calendar, Outlook, etc.)
- A real person wrote this specifically to me and expects/deserves a reply
- It's a personal conversation (back and forth email thread with a person)
- Important government/official notices (application status, 312 city services, legal)
- Family forwarding something they want me to see personally

Examples to SKIP: ANY email from reminder@superhuman.com, ANY calendar invitation (e.g., "Invitation: Team Meeting @ Mon Jan 20"), Beth emailing about vacation plans, Lia responding to my inquiry about childcare availability, "Application Approved" from city/state government, my sister forwarding a flight itinerary she wants me to review

Examples NOT to skip (these are newsletters even if from an individual's name):
- Derek Sivers' blog posts sent to his mailing list
- Substack newsletters
- Any email with unsubscribe links that goes to many subscribers

Categories (pick ONE):
- skip: Truly personal emails requiring my attention/reply, or important official government notices. This includes personal emails from real people specifically to me about my kids (e.g., a teacher emailing me directly, a parent emailing me personally).
- children: ONLY group or automated emails about my kids Ada and Isaac. Must be one of: (1) emails sent to a GROUP (multiple parents, a class list, etc.) about school/activities/camps, (2) automated system emails (Nanit reports, school portal notifications, activity registration confirmations). Do NOT put personal 1-on-1 emails from a real person here - those go in skip.
- amazon: Amazon orders, shipping, deliveries, returns
- billing: Bills with amounts DUE that need to be paid - invoices, utility bills, service bills, subscription renewal notices with pricing. NOT receipts (things already paid), NOT transaction histories.
- receipts: Payment confirmations for things already paid - purchase receipts, subscription payment confirmations, proof of coverage/purchase documents, order confirmations showing amount paid
- investments: Investment accounts, portfolio updates, dividends, trade confirmations
- kickstarter: Kickstarter, Indiegogo, crowdfunding updates
- newsletters: Newsletter subscriptions, periodic digests, Substack, blog digests (even from individuals)
- marketing: Marketing emails, promotions, sales, ads, follow-up sales emails from businesses
- notifications: System notifications, product updates, policy changes, announcements from services/apps (NOT financial, shipping, or security)
- npm: NPM package publish notifications from npmjs.com, npm registry emails
- security-alerts: Sign-in notifications, login alerts, password change alerts, security warnings, "new device" alerts
- confirmation-codes: OTP codes, verification codes, 2FA codes, login codes
- reminders: Automated event reminders, appointment reminders (NOT calendar invitations - those go in skip)
- financial-notifications: Transaction histories (Venmo monthly summary), Explanation of Benefits (EOBs), investment notifications, bank account notifications, statement availability notices
- shipping: Shipment tracking updates, delivery notifications, "your order has shipped" emails, package tracking

Think step by step: First, is this a newsletter/mass email? If yes, categorize it appropriately. If no, is this truly personal correspondence or an important official notice? If yes, skip. For children-related emails specifically: Is this from a real person writing directly to me (skip) OR is it a group email/automated system email (children)?`;
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
  return `Analyze this billing/payment email and extract the amount owed.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. Brief description of what this bill or payment is for (e.g., "Citi credit card statement", "Electric bill", "Netflix subscription")
2. The dollar amount - IMPORTANT: You MUST extract any dollar amount you find. Look for:
   - "Statement Balance" followed by an amount like "$544.02"
   - "Amount Due" or "Total Due" followed by an amount
   - "Balance" followed by an amount
   - Any dollar amount with $ sign
   Return the amount as a string like "$544.02". Only return empty string if there is truly no dollar amount anywhere.`;
}

function buildReceiptsEnrichmentPrompt(thread: RawThread): string {
  return `Analyze this receipt/payment confirmation email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. Brief description of what was purchased or paid for (merchant name or service)
2. The total dollar amount paid if visible (e.g. "$49.99", "$125.00"). If no amount is visible, return null.
3. Individual line items if the receipt lists them (item name and amount for each). If no itemized list is visible, return an empty array.`;
}

function buildNewsletterEnrichmentPrompt(thread: RawThread): string {
  return `Find links in this newsletter email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Find these two types of links:

1. Web view link - URL to view this newsletter in a web browser. Common patterns:
   - "View in browser" / "View in your browser"
   - "Read online" / "View this email online"

2. Unsubscribe link - URL to unsubscribe from this newsletter. Common patterns:
   - "Unsubscribe" / "Opt out"
   - "Manage preferences" / "Email preferences"
   - "Subscription preferences"

Return the full URLs (starting with http:// or https://) if found, or null if not found.`;
}

function buildFinancialEnrichmentPrompt(thread: RawThread): string {
  return `Analyze this financial notification email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. Brief description of what this financial notification is about (e.g., "Venmo payment received", "EOB for doctor visit", "Dividend payment")
2. The dollar amount if visible (e.g. "$49.99", "$1,234.56"). Look for transaction amounts, payment amounts, dividend amounts, claim amounts, etc. If no amount is visible, return null.`;
}

function buildNpmSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
  return `Here are NPM package publish notifications. Summarize which packages were published and what versions.

Group by package name. If the same package has multiple versions published, list all versions together.
Format: "@scope/package: v1.0.0, v1.0.1; @scope/other: v2.0.0"

Keep it concise - just package names and versions, nothing else.

${threadBodies}`;
}

function buildSecurityAlertsSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
  return `Here are security alert emails (sign-in notifications, password changes, new device alerts, etc.).

Summarize them grouped by service. Include:
- The service name (Google, Apple, bank name, etc.)
- Type of alert (sign-in, new device, password change)
- Location or device info if mentioned

Format: "Google: 2 sign-ins (Chicago, NYC); Apple: new device added; Chase: password changed"

Keep it concise - just service, alert type, and key details.

${threadBodies}`;
}

function buildConfirmationCodesSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
  return `Here are confirmation code / verification emails (OTP codes, 2FA codes, verification links, etc.).

Summarize them grouped by service. Include:
- The service name
- The code if visible (numeric codes like 123456)
- Or note "verification link" if it's a link-based verification

Format: "GitHub: 123456; Slack: 789012; Gmail: verification link"

Keep it concise - just service and code/type.

${threadBodies}`;
}

function buildRemindersSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
  return `Here are calendar reminders, event notifications, and appointment reminders.

Summarize them grouped by date/time if available. Include:
- The date/time (Today, Tomorrow, specific date)
- What the event/reminder is about
- Location if mentioned

Format: "Today: dentist 2pm, team sync 4pm; Tomorrow: flight to NYC 8am; Jan 20: doctor appointment"

Keep it concise - just date, event, and time.

${threadBodies}`;
}

function buildFinancialSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
  return `Here are financial notification emails (transaction histories, EOBs, account statements, etc.).

Summarize them grouped by service/company. Include:
- The service name (Venmo, UHC, bank name, etc.)
- Type of notification (transaction history, EOB, statement available)
- Time period if mentioned

Format: "Venmo: December transaction history; UHC: EOB available; Chase: statement ready"

Keep it concise - just service, notification type, and key details.

${threadBodies}`;
}

function buildShippingSummaryPrompt(threads: RawThread[]): string {
  const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
  return `Here are shipping notification emails (order shipped, delivery updates, tracking).

Summarize them grouped by sender/company. Include:
- The sender (Apple, Amazon, FedEx, etc.)
- What was shipped (product name if mentioned)
- Delivery status or expected date if available

Format: "Apple: AirPods shipped, arriving Jan 18; Amazon: package delivered; FedEx: package in transit"

Keep it concise - just sender, item, and status.

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
          body: details.body,
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
      skip: [] as string[],
      children: [] as string[],
      amazon: [] as string[],
      billing: [] as string[],
      receipts: [] as string[],
      investments: [] as string[],
      kickstarter: [] as string[],
      newsletters: [] as string[],
      marketing: [] as string[],
      notifications: [] as string[],
      npm: [] as string[],
      securityAlerts: [] as string[],
      confirmationCodes: [] as string[],
      reminders: [] as string[],
      financialNotifications: [] as string[],
      shipping: [] as string[],
      childrenInfo: {} as Record<string, ChildrenEmailInfo>,
      billingInfo: {} as Record<string, BillingEmailInfo>,
      receiptsInfo: {} as Record<string, ReceiptsEmailInfo>,
      newslettersInfo: {} as Record<string, NewsletterEmailInfo>,
      npmSummary: '' as string,
      securityAlertsSummary: '' as string,
      confirmationCodesSummary: '' as string,
      remindersSummary: '' as string,
      financialSummary: '' as string,
      shippingSummary: '' as string,
    } as any;
  })

  .step('Categorize all threads', async ({ state, client }) => {
    const threadsById = state.threadsById as unknown as Record<string, RawThread>;
    const threadEntries = Object.entries(threadsById);

    if (threadEntries.length === 0) {
      return state;
    }

    const categories: Record<string, string[]> = {
      skip: [],
      children: [],
      amazon: [],
      billing: [],
      receipts: [],
      investments: [],
      kickstarter: [],
      newsletters: [],
      marketing: [],
      notifications: [],
      npm: [],
      'security-alerts': [],
      'confirmation-codes': [],
      'reminders': [],
      'financial-notifications': [],
      'shipping': [],
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

  .step('Enrich children, billing, receipts, newsletters, and notification threads', async ({ state, client }) => {
    const threadsById = state.threadsById as unknown as Record<string, RawThread>;
    const childrenIds = state.children as unknown as string[];
    const billingIds = state.billing as unknown as string[];
    const receiptsIds = (state as any).receipts as string[] || [];
    const newsletterIds = state.newsletters as unknown as string[];
    const npmIds = state.npm as unknown as string[];
    const securityAlertIds = (state as any)['security-alerts'] as string[] || [];
    const confirmationCodeIds = (state as any)['confirmation-codes'] as string[] || [];
    const reminderIds = (state as any)['reminders'] as string[] || [];
    const financialIds = (state as any)['financial-notifications'] as string[] || [];
    const shippingIds = (state as any)['shipping'] as string[] || [];

    const childrenInfo: Record<string, ChildrenEmailInfo> = {};
    const billingInfo: Record<string, BillingEmailInfo> = {};
    const receiptsInfo: Record<string, ReceiptsEmailInfo> = {};
    const newslettersInfo: Record<string, NewsletterEmailInfo> = {};
    const financialInfo: Record<string, FinancialEmailInfo> = {};

    // Build enrichment tasks for all categories
    type EnrichmentTask = {
      threadId: string;
      type: 'children' | 'billing' | 'receipts' | 'newsletters' | 'financial';
      thread: RawThread;
    };

    const enrichmentTasks: EnrichmentTask[] = [
      ...childrenIds.map(threadId => ({ threadId, type: 'children' as const, thread: threadsById[threadId] })),
      ...billingIds.map(threadId => ({ threadId, type: 'billing' as const, thread: threadsById[threadId] })),
      ...receiptsIds.map(threadId => ({ threadId, type: 'receipts' as const, thread: threadsById[threadId] })),
      ...newsletterIds.map(threadId => ({ threadId, type: 'newsletters' as const, thread: threadsById[threadId] })),
      ...financialIds.map(threadId => ({ threadId, type: 'financial' as const, thread: threadsById[threadId] })),
    ].filter(task => task.thread);

    // Process enrichment tasks in batches
    const BATCH_SIZE = 20;
    for (let i = 0; i < enrichmentTasks.length; i += BATCH_SIZE) {
      const batch = enrichmentTasks.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async (task, idx) => {
        await new Promise((resolve) => setTimeout(resolve, idx * 30));

        if (task.type === 'children') {
          const result = await withRetry(() =>
            client.generateObject({
              prompt: buildChildrenEnrichmentPrompt(task.thread),
              schema: childrenEnrichmentSchema,
              schemaName: 'childrenEmailInfo',
            })
          );
          return { ...task, result };
        } else if (task.type === 'billing') {
          const result = await withRetry(() =>
            client.generateObject({
              prompt: buildBillingEnrichmentPrompt(task.thread),
              schema: billingEnrichmentSchema,
              schemaName: 'billingEmailInfo',
            })
          );
          return { ...task, result };
        } else if (task.type === 'receipts') {
          const result = await withRetry(() =>
            client.generateObject({
              prompt: buildReceiptsEnrichmentPrompt(task.thread),
              schema: receiptsEnrichmentSchema,
              schemaName: 'receiptsEmailInfo',
            })
          );
          return { ...task, result };
        } else if (task.type === 'newsletters') {
          const result = await withRetry(() =>
            client.generateObject({
              prompt: buildNewsletterEnrichmentPrompt(task.thread),
              schema: newsletterEnrichmentSchema,
              schemaName: 'newsletterEmailInfo',
            })
          );
          return { ...task, result };
        } else {
          const result = await withRetry(() =>
            client.generateObject({
              prompt: buildFinancialEnrichmentPrompt(task.thread),
              schema: financialEnrichmentSchema,
              schemaName: 'financialEmailInfo',
            })
          );
          return { ...task, result };
        }
      });

      const results = await Promise.all(promises);

      for (const { threadId, type, result } of results) {
        if (type === 'children') {
          childrenInfo[threadId] = result as ChildrenEmailInfo;
        } else if (type === 'billing') {
          billingInfo[threadId] = result as BillingEmailInfo;
        } else if (type === 'receipts') {
          receiptsInfo[threadId] = result as ReceiptsEmailInfo;
        } else if (type === 'newsletters') {
          newslettersInfo[threadId] = result as NewsletterEmailInfo;
        } else {
          financialInfo[threadId] = result as FinancialEmailInfo;
        }
      }
    }

    // Generate summaries in parallel
    const summaryPromises: Promise<void>[] = [];
    let npmSummary = '';
    let securityAlertsSummary = '';
    let confirmationCodesSummary = '';
    let remindersSummary = '';
    let financialSummary = '';
    let shippingSummary = '';

    if (npmIds.length > 0) {
      summaryPromises.push((async () => {
        const npmThreads = npmIds.map(threadId => threadsById[threadId]).filter(Boolean);
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildNpmSummaryPrompt(npmThreads),
            schema: npmSummarySchema,
            schemaName: 'npmSummary',
          })
        );
        npmSummary = result.summary;
      })());
    }

    if (securityAlertIds.length > 0) {
      summaryPromises.push((async () => {
        const securityThreads = securityAlertIds.map(threadId => threadsById[threadId]).filter(Boolean);
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildSecurityAlertsSummaryPrompt(securityThreads),
            schema: securityAlertsSummarySchema,
            schemaName: 'securityAlertsSummary',
          })
        );
        securityAlertsSummary = result.summary;
      })());
    }

    if (confirmationCodeIds.length > 0) {
      summaryPromises.push((async () => {
        const codeThreads = confirmationCodeIds.map(threadId => threadsById[threadId]).filter(Boolean);
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildConfirmationCodesSummaryPrompt(codeThreads),
            schema: confirmationCodesSummarySchema,
            schemaName: 'confirmationCodesSummary',
          })
        );
        confirmationCodesSummary = result.summary;
      })());
    }

    if (reminderIds.length > 0) {
      summaryPromises.push((async () => {
        const reminderThreads = reminderIds.map(threadId => threadsById[threadId]).filter(Boolean);
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildRemindersSummaryPrompt(reminderThreads),
            schema: remindersSummarySchema,
            schemaName: 'remindersSummary',
          })
        );
        remindersSummary = result.summary;
      })());
    }

    if (financialIds.length > 0) {
      summaryPromises.push((async () => {
        const financialThreads = financialIds.map(threadId => threadsById[threadId]).filter(Boolean);
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildFinancialSummaryPrompt(financialThreads),
            schema: financialSummarySchema,
            schemaName: 'financialSummary',
          })
        );
        financialSummary = result.summary;
      })());
    }

    if (shippingIds.length > 0) {
      summaryPromises.push((async () => {
        const shippingThreads = shippingIds.map(threadId => threadsById[threadId]).filter(Boolean);
        const result = await withRetry(() =>
          client.generateObject({
            prompt: buildShippingSummaryPrompt(shippingThreads),
            schema: shippingSummarySchema,
            schemaName: 'shippingSummary',
          })
        );
        shippingSummary = result.summary;
      })());
    }

    await Promise.all(summaryPromises);

    return {
      ...state,
      childrenInfo,
      billingInfo,
      receiptsInfo,
      newslettersInfo,
      financialInfo,
      npmSummary,
      securityAlertsSummary,
      confirmationCodesSummary,
      remindersSummary,
      financialSummary,
      shippingSummary,
    } as any;
  })

  .step('Generate unified summary page', async ({ state, pages, env }) => {
    const s = state as any;
    const processedData: ProcessedEmails = {
      threadsById: s.threadsById,
      children: s.children as string[],
      amazon: s.amazon as string[],
      billing: s.billing as string[],
      receipts: s.receipts as string[] || [],
      investments: s.investments as string[],
      kickstarter: s.kickstarter as string[],
      newsletters: s.newsletters as string[],
      marketing: s.marketing as string[],
      notifications: s.notifications as string[],
      npm: s.npm as string[],
      securityAlerts: s['security-alerts'] as string[] || [],
      confirmationCodes: s['confirmation-codes'] as string[] || [],
      reminders: s['reminders'] as string[] || [],
      financialNotifications: s['financial-notifications'] as string[] || [],
      shipping: s['shipping'] as string[] || [],
      childrenInfo: s.childrenInfo as Record<string, ChildrenEmailInfo>,
      billingInfo: s.billingInfo as Record<string, BillingEmailInfo>,
      receiptsInfo: s.receiptsInfo as Record<string, ReceiptsEmailInfo>,
      newslettersInfo: s.newslettersInfo as Record<string, NewsletterEmailInfo>,
      financialInfo: s.financialInfo as Record<string, FinancialEmailInfo>,
      npmSummary: s.npmSummary as string,
      securityAlertsSummary: s.securityAlertsSummary as string,
      confirmationCodesSummary: s.confirmationCodesSummary as string,
      remindersSummary: s.remindersSummary as string,
      financialSummary: s.financialSummary as string,
      shippingSummary: s.shippingSummary as string,
    };

    const totalEmails =
      processedData.children.length +
      processedData.amazon.length +
      processedData.billing.length +
      processedData.receipts.length +
      processedData.investments.length +
      processedData.kickstarter.length +
      processedData.newsletters.length +
      processedData.marketing.length +
      processedData.notifications.length +
      processedData.npm.length +
      processedData.securityAlerts.length +
      processedData.confirmationCodes.length +
      processedData.reminders.length +
      processedData.financialNotifications.length +
      processedData.shipping.length;

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
    const receipts = (state as any).receipts as string[] || [];
    const investments = (state as any).investments as string[];
    const kickstarter = (state as any).kickstarter as string[];
    const newsletters = (state as any).newsletters as string[];
    const marketing = (state as any).marketing as string[];
    const notifications = (state as any).notifications as string[];
    const npm = (state as any).npm as string[];
    const securityAlerts = (state as any)['security-alerts'] as string[] || [];
    const confirmationCodes = (state as any)['confirmation-codes'] as string[] || [];
    const reminders = (state as any)['reminders'] as string[] || [];
    const financialNotifications = (state as any)['financial-notifications'] as string[] || [];
    const shipping = (state as any)['shipping'] as string[] || [];

    // Combine all notification types for the count
    const allNotifications = notifications.length + npm.length + securityAlerts.length + confirmationCodes.length + reminders.length + financialNotifications.length + shipping.length;

    const counts = [
      children.length > 0 ? `${children.length} children` : null,
      amazon.length > 0 ? `${amazon.length} Amazon` : null,
      billing.length > 0 ? `${billing.length} billing` : null,
      receipts.length > 0 ? `${receipts.length} receipts` : null,
      investments.length > 0 ? `${investments.length} investments` : null,
      kickstarter.length > 0 ? `${kickstarter.length} Kickstarter` : null,
      newsletters.length > 0 ? `${newsletters.length} newsletters` : null,
      marketing.length > 0 ? `${marketing.length} marketing` : null,
      allNotifications > 0 ? `${allNotifications} notifications` : null,
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
