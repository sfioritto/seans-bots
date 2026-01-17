import { brain } from '../brain.js';
import archiveWebhook from '../webhooks/archive.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type { ProcessedEmails, RawThread, ChildrenEmailInfo, BillingEmailInfo, ReceiptsEmailInfo, NewsletterEmailInfo, FinancialEmailInfo } from './email-digest/types.js';
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

const emailDigestBrain = brain({
  title: 'email-digest',
  description: 'Categorizes inbox emails and extracts key info like action items and bill amounts',
})
  .brain(
    'Process Mercury receipt requests',
    mercuryReceiptsBrain,
    () => ({}),
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
          ...details,
          threadId: thread.threadId,
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
    over: (state) => Object.values(state.threadsById as Record<string, RawThread>),
  })

  // Organize categorization results into separate arrays
  .step('Organize by category', ({ state }) => {
    const skip: string[] = [];
    const children: string[] = [];
    const amazon: string[] = [];
    const billing: string[] = [];
    const receipts: string[] = [];
    const investments: string[] = [];
    const kickstarter: string[] = [];
    const newsletters: string[] = [];
    const marketing: string[] = [];
    const notifications: string[] = [];
    const npm: string[] = [];
    const securityAlerts: string[] = [];
    const confirmationCodes: string[] = [];
    const reminders: string[] = [];
    const financialNotifications: string[] = [];
    const shipping: string[] = [];

    const categoryMap: Record<string, string[]> = {
      skip,
      children,
      amazon,
      billing,
      receipts,
      investments,
      kickstarter,
      newsletters,
      marketing,
      notifications,
      npm,
      'security-alerts': securityAlerts,
      'confirmation-codes': confirmationCodes,
      reminders,
      'financial-notifications': financialNotifications,
      shipping,
    };

    for (const [thread, result] of state.categorized) {
      const arr = categoryMap[result.category];
      if (arr) {
        arr.push(thread.threadId);
      }
    }

    return {
      ...state,
      skip,
      children,
      amazon,
      billing,
      receipts,
      investments,
      kickstarter,
      newsletters,
      marketing,
      notifications,
      npm,
      securityAlerts,
      confirmationCodes,
      reminders,
      financialNotifications,
      shipping,
    };
  })

  // Prepare threads for enrichment by mapping IDs to thread objects
  .step('Prepare enrichment threads', ({ state }) => {
    const threadsById = state.threadsById;

    return {
      ...state,
      childrenThreads: state.children.map((id) => threadsById[id]).filter(Boolean),
      billingThreads: state.billing.map((id) => threadsById[id]).filter(Boolean),
      receiptsThreads: state.receipts.map((id) => threadsById[id]).filter(Boolean),
      newsletterThreads: state.newsletters.map((id) => threadsById[id]).filter(Boolean),
      financialThreads: state.financialNotifications.map((id) => threadsById[id]).filter(Boolean),
      npmThreads: state.npm.map((id) => threadsById[id]).filter(Boolean),
      securityAlertThreads: state.securityAlerts.map((id) => threadsById[id]).filter(Boolean),
      confirmationCodeThreads: state.confirmationCodes.map((id) => threadsById[id]).filter(Boolean),
      reminderThreads: state.reminders.map((id) => threadsById[id]).filter(Boolean),
      shippingThreads: state.shipping.map((id) => threadsById[id]).filter(Boolean),
    };
  })

  // Batch enrich each category
  .prompt('Enrich children emails', enrichChildrenPrompt, {
    over: (state) => state.childrenThreads as RawThread[],
  })
  .prompt('Enrich billing emails', enrichBillingPrompt, {
    over: (state) => state.billingThreads as RawThread[],
  })
  .prompt('Enrich receipt emails', enrichReceiptsPrompt, {
    over: (state) => state.receiptsThreads as RawThread[],
  })
  .prompt('Enrich newsletter emails', enrichNewslettersPrompt, {
    over: (state) => state.newsletterThreads as RawThread[],
  })
  .prompt('Enrich financial emails', enrichFinancialPrompt, {
    over: (state) => state.financialThreads as RawThread[],
  })

  // Transform enrichment tuples to info objects keyed by threadId
  // Also clean up intermediate data to reduce state size
  .step('Transform enrichment results', ({ state }) => {
    const childrenEnriched = (state.childrenEnriched || []) as [RawThread, ChildrenEmailInfo][];
    const billingEnriched = (state.billingEnriched || []) as [RawThread, BillingEmailInfo][];
    const receiptsEnriched = (state.receiptsEnriched || []) as [RawThread, ReceiptsEmailInfo][];
    const newslettersEnriched = (state.newslettersEnriched || []) as [RawThread, NewsletterEmailInfo][];
    const financialEnriched = (state.financialEnriched || []) as [RawThread, FinancialEmailInfo][];

    const childrenInfo: Record<string, ChildrenEmailInfo> = {};
    for (const [thread, info] of childrenEnriched) {
      childrenInfo[thread.threadId] = info;
    }

    const billingInfo: Record<string, BillingEmailInfo> = {};
    for (const [thread, info] of billingEnriched) {
      billingInfo[thread.threadId] = info;
    }

    const receiptsInfo: Record<string, ReceiptsEmailInfo> = {};
    for (const [thread, info] of receiptsEnriched) {
      receiptsInfo[thread.threadId] = info;
    }

    const newslettersInfo: Record<string, NewsletterEmailInfo> = {};
    for (const [thread, info] of newslettersEnriched) {
      newslettersInfo[thread.threadId] = info;
    }

    const financialInfo: Record<string, FinancialEmailInfo> = {};
    for (const [thread, info] of financialEnriched) {
      financialInfo[thread.threadId] = info;
    }

    // Clean up intermediate data - keep summary thread arrays for next step
    const {
      categorized: _categorized,
      childrenThreads: _childrenThreads,
      billingThreads: _billingThreads,
      receiptsThreads: _receiptsThreads,
      newsletterThreads: _newsletterThreads,
      // Keep financialThreads - still needed for summaries
      childrenEnriched: _childrenEnriched,
      billingEnriched: _billingEnriched,
      receiptsEnriched: _receiptsEnriched,
      newslettersEnriched: _newslettersEnriched,
      financialEnriched: _financialEnriched,
      ...cleanedState
    } = state;

    return {
      ...cleanedState,
      childrenInfo,
      billingInfo,
      receiptsInfo,
      newslettersInfo,
      financialInfo,
    };
  })

  // Generate summaries for categories that need them (conditional, parallel)
  .step('Generate category summaries', async ({ state, client }) => {
    const summaries = {
      npmSummary: '',
      securityAlertsSummary: '',
      confirmationCodesSummary: '',
      remindersSummary: '',
      financialSummary: '',
      shippingSummary: '',
    };

    const promises: Promise<void>[] = [];

    if (state.npmThreads.length > 0) {
      promises.push((async () => {
        const result = await client.generateObject({
          prompt: summarizeNpmPrompt.template(state.npmThreads),
          schema: summarizeNpmPrompt.outputSchema.schema,
          schemaName: summarizeNpmPrompt.outputSchema.name,
        });
        summaries.npmSummary = result.summary;
      })());
    }

    if (state.securityAlertThreads.length > 0) {
      promises.push((async () => {
        const result = await client.generateObject({
          prompt: summarizeSecurityAlertsPrompt.template(state.securityAlertThreads),
          schema: summarizeSecurityAlertsPrompt.outputSchema.schema,
          schemaName: summarizeSecurityAlertsPrompt.outputSchema.name,
        });
        summaries.securityAlertsSummary = result.summary;
      })());
    }

    if (state.confirmationCodeThreads.length > 0) {
      promises.push((async () => {
        const result = await client.generateObject({
          prompt: summarizeConfirmationCodesPrompt.template(state.confirmationCodeThreads),
          schema: summarizeConfirmationCodesPrompt.outputSchema.schema,
          schemaName: summarizeConfirmationCodesPrompt.outputSchema.name,
        });
        summaries.confirmationCodesSummary = result.summary;
      })());
    }

    if (state.reminderThreads.length > 0) {
      promises.push((async () => {
        const result = await client.generateObject({
          prompt: summarizeRemindersPrompt.template(state.reminderThreads),
          schema: summarizeRemindersPrompt.outputSchema.schema,
          schemaName: summarizeRemindersPrompt.outputSchema.name,
        });
        summaries.remindersSummary = result.summary;
      })());
    }

    if (state.financialThreads.length > 0) {
      promises.push((async () => {
        const result = await client.generateObject({
          prompt: summarizeFinancialPrompt.template(state.financialThreads),
          schema: summarizeFinancialPrompt.outputSchema.schema,
          schemaName: summarizeFinancialPrompt.outputSchema.name,
        });
        summaries.financialSummary = result.summary;
      })());
    }

    if (state.shippingThreads.length > 0) {
      promises.push((async () => {
        const result = await client.generateObject({
          prompt: summarizeShippingPrompt.template(state.shippingThreads),
          schema: summarizeShippingPrompt.outputSchema.schema,
          schemaName: summarizeShippingPrompt.outputSchema.name,
        });
        summaries.shippingSummary = result.summary;
      })());
    }

    await Promise.all(promises);

    // Clean up summary thread arrays - no longer needed
    const {
      npmThreads: _npmThreads,
      securityAlertThreads: _securityAlertThreads,
      confirmationCodeThreads: _confirmationCodeThreads,
      reminderThreads: _reminderThreads,
      financialThreads: _financialThreads,
      shippingThreads: _shippingThreads,
      ...cleanedState
    } = state;

    return {
      ...cleanedState,
      ...summaries,
    };
  })

  .step('Generate unified summary page', async ({ state, pages, env }) => {
    const processedData: ProcessedEmails = {
      threadsById: state.threadsById,
      children: state.children,
      amazon: state.amazon,
      billing: state.billing,
      receipts: state.receipts,
      investments: state.investments,
      kickstarter: state.kickstarter,
      newsletters: state.newsletters,
      marketing: state.marketing,
      notifications: state.notifications,
      npm: state.npm,
      securityAlerts: state.securityAlerts,
      confirmationCodes: state.confirmationCodes,
      reminders: state.reminders,
      financialNotifications: state.financialNotifications,
      shipping: state.shipping,
      childrenInfo: state.childrenInfo,
      billingInfo: state.billingInfo,
      receiptsInfo: state.receiptsInfo,
      newslettersInfo: state.newslettersInfo,
      financialInfo: state.financialInfo,
      npmSummary: state.npmSummary,
      securityAlertsSummary: state.securityAlertsSummary,
      confirmationCodesSummary: state.confirmationCodesSummary,
      remindersSummary: state.remindersSummary,
      financialSummary: state.financialSummary,
      shippingSummary: state.shippingSummary,
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

    return { ...state, sessionId, pageUrl: `${env.origin}/pages/${slug}` };
  })

  .step('Send notification', async ({ state, ntfy }) => {
    if (!state.pageUrl) {
      return state;
    }

    const allNotifications =
      state.notifications.length +
      state.npm.length +
      state.securityAlerts.length +
      state.confirmationCodes.length +
      state.reminders.length +
      state.financialNotifications.length +
      state.shipping.length;

    const counts = [
      state.children.length > 0 ? `${state.children.length} children` : null,
      state.amazon.length > 0 ? `${state.amazon.length} Amazon` : null,
      state.billing.length > 0 ? `${state.billing.length} billing` : null,
      state.receipts.length > 0 ? `${state.receipts.length} receipts` : null,
      state.investments.length > 0 ? `${state.investments.length} investments` : null,
      state.kickstarter.length > 0 ? `${state.kickstarter.length} Kickstarter` : null,
      state.newsletters.length > 0 ? `${state.newsletters.length} newsletters` : null,
      state.marketing.length > 0 ? `${state.marketing.length} marketing` : null,
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
    const threadsById = state.threadsById;

    // Group message IDs by account name
    const messagesByAccount: Record<string, string[]> = {};
    for (const threadId of selectedThreadIds) {
      const thread = threadsById[threadId];
      if (thread) {
        const key = thread.accountName;
        if (!messagesByAccount[key]) {
          messagesByAccount[key] = [];
        }
        messagesByAccount[key].push(...thread.messageIds);
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
