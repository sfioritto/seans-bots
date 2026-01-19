import { brain } from '../brain.js';
import archiveWebhook from '../webhooks/archive.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type {
  ProcessedEmails,
  RawThread,
  CategorizedEmail,
  EmailCategory,
  EnrichmentData,
  CategorySummaries,
  ChildrenEmailInfo,
  BillingEmailInfo,
  ReceiptsEmailInfo,
  NewsletterEmailInfo,
  FinancialEmailInfo,
} from './email-digest/types.js';
import mercuryReceiptsBrain from './mercury-receipts.js';

// Prompts
import { categorizePrompt } from './email-digest/prompts/categorize.js';
import { enrichChildrenPrompt } from './email-digest/prompts/enrich-children.js';
import { enrichBillingPrompt } from './email-digest/prompts/enrich-billing.js';
import { enrichReceiptsPrompt } from './email-digest/prompts/enrich-receipts.js';
import { enrichNewslettersPrompt } from './email-digest/prompts/enrich-newsletters.js';
import { enrichFinancialPrompt } from './email-digest/prompts/enrich-financial.js';
import { summarizeNpmPrompt } from './email-digest/prompts/summarize-npm.js';
import { summarizeSecurityAlertsPrompt } from './email-digest/prompts/summarize-security-alerts.js';
import { summarizeConfirmationCodesPrompt } from './email-digest/prompts/summarize-confirmation-codes.js';
import { summarizeRemindersPrompt } from './email-digest/prompts/summarize-reminders.js';
import { summarizeFinancialPrompt } from './email-digest/prompts/summarize-financial.js';
import { summarizeShippingPrompt } from './email-digest/prompts/summarize-shipping.js';

// Helper to filter emails by category
const byCategory = (emails: CategorizedEmail[], category: EmailCategory) =>
  emails.filter((e) => e.category === category);

const emailDigestBrain = brain({
  title: 'email-digest',
  description: 'Categorizes inbox emails and extracts key info like action items and bill amounts',
})
  .brain('Process Mercury receipt requests', mercuryReceiptsBrain, () => ({}))

  .step('Fetch all inbox threads from all accounts', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();
    const threadsById: Record<string, RawThread> = {};
    const query = 'label:inbox';

    for (const account of accounts) {
      const threads = await gmail.searchThreads(account.refreshToken, query, 100);

      for (const thread of threads) {
        const details = await gmail.getThreadDetails(account.refreshToken, thread.threadId);
        threadsById[thread.threadId] = {
          ...details,
          accountName: account.name,
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      ...state,
      threadsById,
    };
  })

  // Batch categorize all threads
  .prompt('Categorize all threads', categorizePrompt, {
    over: (state) => Object.values(state.threadsById),
  })

  // Build unified email list from categorization results
  .step('Build categorized emails', ({ state }) => {
    const emails: CategorizedEmail[] = state.categorized
      .filter(([_, result]: [RawThread, { category: EmailCategory }]) => result.category !== 'skip')
      .map(([thread, result]: [RawThread, { category: EmailCategory }]) => ({
        thread,
        category: result.category,
        enrichment: null as EnrichmentData,
      }));

    return {
      ...state,
      emails,
    };
  })

  // Batch enrich categories that need enrichment
  .prompt('Enrich children emails', enrichChildrenPrompt, {
    over: (state) => byCategory(state.emails, 'children').map((e) => e.thread),
  })
  .prompt('Enrich billing emails', enrichBillingPrompt, {
    over: (state) => byCategory(state.emails, 'billing').map((e) => e.thread),
  })
  .prompt('Enrich receipt emails', enrichReceiptsPrompt, {
    over: (state) => byCategory(state.emails, 'receipts').map((e) => e.thread),
  })
  .prompt('Enrich newsletter emails', enrichNewslettersPrompt, {
    over: (state) => byCategory(state.emails, 'newsletters').map((e) => e.thread),
  })
  .prompt('Enrich financial emails', enrichFinancialPrompt, {
    over: (state) => byCategory(state.emails, 'financialNotifications').map((e) => e.thread),
  })

  // Merge enrichment data back into unified email list
  .step('Merge enrichment data', ({ state }) => {
    const childrenEnriched = (state.childrenEnriched || []) as [RawThread, ChildrenEmailInfo][];
    const billingEnriched = (state.billingEnriched || []) as [RawThread, BillingEmailInfo][];
    const receiptsEnriched = (state.receiptsEnriched || []) as [RawThread, ReceiptsEmailInfo][];
    const newslettersEnriched = (state.newslettersEnriched || []) as [RawThread, NewsletterEmailInfo][];
    const financialEnriched = (state.financialEnriched || []) as [RawThread, FinancialEmailInfo][];

    // Build lookup maps from enrichment results
    const childrenMap = new Map(childrenEnriched.map(([t, info]) => [t.threadId, info]));
    const billingMap = new Map(billingEnriched.map(([t, info]) => [t.threadId, info]));
    const receiptsMap = new Map(receiptsEnriched.map(([t, info]) => [t.threadId, info]));
    const newslettersMap = new Map(newslettersEnriched.map(([t, info]) => [t.threadId, info]));
    const financialMap = new Map(financialEnriched.map(([t, info]) => [t.threadId, info]));

    // Merge enrichment into unified list
    const enrichedEmails = state.emails.map((email: CategorizedEmail) => {
      const id = email.thread.threadId;
      let enrichment: EnrichmentData = null;

      if (childrenMap.has(id)) {
        enrichment = { type: 'children', info: childrenMap.get(id)! };
      } else if (billingMap.has(id)) {
        enrichment = { type: 'billing', info: billingMap.get(id)! };
      } else if (receiptsMap.has(id)) {
        enrichment = { type: 'receipts', info: receiptsMap.get(id)! };
      } else if (newslettersMap.has(id)) {
        enrichment = { type: 'newsletters', info: newslettersMap.get(id)! };
      } else if (financialMap.has(id)) {
        enrichment = { type: 'financial', info: financialMap.get(id)! };
      }

      return { ...email, enrichment };
    });

    // Clean up intermediate enrichment data
    const {
      categorized: _categorized,
      childrenEnriched: _childrenEnriched,
      billingEnriched: _billingEnriched,
      receiptsEnriched: _receiptsEnriched,
      newslettersEnriched: _newslettersEnriched,
      financialEnriched: _financialEnriched,
      ...cleanedState
    } = state;

    return {
      ...cleanedState,
      emails: enrichedEmails,
    };
  })

  // Generate summaries for categories that need them
  .prompt('Summarize npm', summarizeNpmPrompt)
  .prompt('Summarize security alerts', summarizeSecurityAlertsPrompt)
  .prompt('Summarize confirmation codes', summarizeConfirmationCodesPrompt)
  .prompt('Summarize reminders', summarizeRemindersPrompt)
  .prompt('Summarize financial', summarizeFinancialPrompt)
  .prompt('Summarize shipping', summarizeShippingPrompt)

  // Merge summaries into final structure
  .step('Build summaries', ({ state }) => {
    const summaries: CategorySummaries = {};

    if (state.npmSummary?.summary) summaries.npm = state.npmSummary.summary;
    if (state.securityAlertsSummary?.summary) summaries.securityAlerts = state.securityAlertsSummary.summary;
    if (state.confirmationCodesSummary?.summary) summaries.confirmationCodes = state.confirmationCodesSummary.summary;
    if (state.remindersSummary?.summary) summaries.reminders = state.remindersSummary.summary;
    if (state.financialSummary?.summary) summaries.financial = state.financialSummary.summary;
    if (state.shippingSummary?.summary) summaries.shipping = state.shippingSummary.summary;

    // Clean up intermediate summary data
    const {
      npmSummary: _npmSummary,
      securityAlertsSummary: _securityAlertsSummary,
      confirmationCodesSummary: _confirmationCodesSummary,
      remindersSummary: _remindersSummary,
      financialSummary: _financialSummary,
      shippingSummary: _shippingSummary,
      ...cleanedState
    } = state;

    return {
      ...cleanedState,
      summaries,
    };
  })

  .step('Generate unified summary page', async ({ state, pages, env }) => {
    const { emails, summaries } = state;

    if (emails.length === 0) {
      return { ...state, sessionId: '', pageUrl: '' };
    }

    if (!pages) {
      throw new Error('Pages service not available');
    }

    const processedData: ProcessedEmails = {
      emails,
      summaries,
    };

    const sessionId = crypto.randomUUID();
    const slug = `email-digest-${sessionId.slice(0, 8)}`;

    const tempHtml = '<html><body>Loading...</body></html>';
    await pages.create(slug, tempHtml, { persist: false });

    const webhookUrl = `${env.origin}/webhooks/archive`;

    const html = generateUnifiedPage(processedData, sessionId, webhookUrl);
    await pages.update(slug, html);

    return { ...state, sessionId, pageUrl: `${env.origin}/pages/${slug}` };
  })

  .step('Send notification', async ({ state, ntfy }) => {
    if (!state.pageUrl) {
      return state;
    }

    const { emails } = state;

    // Count by category
    const countByCategory = (cat: EmailCategory) => byCategory(emails, cat).length;

    const notificationCategories: EmailCategory[] = [
      'notifications',
      'npm',
      'securityAlerts',
      'confirmationCodes',
      'reminders',
      'financialNotifications',
      'shipping',
    ];
    const allNotifications = notificationCategories.reduce((sum, cat) => sum + countByCategory(cat), 0);

    const counts = [
      countByCategory('children') > 0 ? `${countByCategory('children')} children` : null,
      countByCategory('amazon') > 0 ? `${countByCategory('amazon')} Amazon` : null,
      countByCategory('billing') > 0 ? `${countByCategory('billing')} billing` : null,
      countByCategory('receipts') > 0 ? `${countByCategory('receipts')} receipts` : null,
      countByCategory('investments') > 0 ? `${countByCategory('investments')} investments` : null,
      countByCategory('kickstarter') > 0 ? `${countByCategory('kickstarter')} Kickstarter` : null,
      countByCategory('newsletters') > 0 ? `${countByCategory('newsletters')} newsletters` : null,
      countByCategory('marketing') > 0 ? `${countByCategory('marketing')} marketing` : null,
      allNotifications > 0 ? `${allNotifications} notifications` : null,
    ].filter(Boolean);

    const message = `Email digest: ${counts.join(', ')}`;
    await ntfy.send(message, state.pageUrl);

    return state;
  })

  .step('Wait for archive confirmation', ({ state }) => {
    if (!state.sessionId) {
      return state;
    }

    const webhook = archiveWebhook(state.sessionId);

    return {
      state,
      waitFor: [webhook],
    };
  })

  .step('Archive threads', async ({ state, response, gmail }) => {
    if (!state.sessionId) {
      return { ...state, archived: false, archivedCount: 0 };
    }

    const webhookResponse = response as { threadIds: string[]; confirmed: boolean } | undefined;

    if (!webhookResponse?.confirmed) {
      return { ...state, archived: false, archivedCount: 0 };
    }

    const selectedThreadIds = new Set(webhookResponse.threadIds);
    const { emails } = state;

    // Build lookup from emails
    const emailsByThreadId = new Map(emails.map((e: CategorizedEmail) => [e.thread.threadId, e]));

    // Group message IDs by account name
    const messagesByAccount: Record<string, string[]> = {};
    for (const threadId of selectedThreadIds) {
      const email = emailsByThreadId.get(threadId);
      if (email) {
        const key = email.thread.accountName;
        if (!messagesByAccount[key]) {
          messagesByAccount[key] = [];
        }
        messagesByAccount[key].push(...email.thread.messageIds);
      }
    }

    // Look up refresh tokens by account name and archive
    const accounts = gmail.getAccounts();
    const accountsByName = new Map(accounts.map((a) => [a.name, a]));

    let totalArchived = 0;
    for (const [accountName, messageIds] of Object.entries(messagesByAccount)) {
      const account = accountsByName.get(accountName);
      if (account) {
        await gmail.archiveMessages(account.refreshToken, messageIds);
        totalArchived += messageIds.length;
      }
    }

    return {
      ...state,
      archived: true,
      archivedCount: totalArchived,
    };
  });

export default emailDigestBrain;
