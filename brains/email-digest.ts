import { brain } from '../brain.js';
import { archiveWebhook } from '../webhooks/archive.js';
import * as isaac from './email-digest/processors/isaac.js';
import * as actionItems from './email-digest/processors/action-items.js';
import * as amazon from './email-digest/processors/amazon.js';
import * as billing from './email-digest/processors/billing.js';
import * as investments from './email-digest/processors/investments.js';
import * as kickstarter from './email-digest/processors/kickstarter.js';
import * as newsletters from './email-digest/processors/newsletters.js';
import * as marketing from './email-digest/processors/marketing.js';
import * as notifications from './email-digest/processors/notifications.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type { ProcessedEmails, RawEmail } from './email-digest/types.js';

const emailDigestBrain = brain({
  title: 'email-digest',
  description: 'Categorizes inbox emails across accounts into Isaac, Amazon, billing, investments, Kickstarter, newsletters, marketing, and notifications with action item extraction',
})
  // Step 1: Fetch ALL inbox emails from ALL accounts
  .step('Fetch all inbox emails from all accounts', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();

    if (accounts.length === 0) {
      console.log('No Gmail accounts configured');
      return {
        ...state,
        allEmails: [] as any[],
        claimedEmailIds: [] as string[],
        processedIsaac: [] as any[],
        processedAmazon: [] as any[],
        processedBilling: [] as any[],
        processedInvestments: [] as any[],
        processedKickstarter: [] as any[],
        processedNewsletters: [] as any[],
        processedMarketing: [] as any[],
        processedNotifications: [] as any[],
        actionItemsMap: {} as Record<string, any[]>,
      };
    }

    console.log(`Fetching emails from ${accounts.length} accounts...`);

    const allEmails: any[] = [];
    const query = 'label:inbox';

    for (const account of accounts) {
      const messages = await gmail.searchMessages(account.refreshToken, query, 100);
      console.log(`Found ${messages.length} emails in ${account.name}`);

      for (const message of messages) {
        const details = await gmail.getMessageDetails(account.refreshToken, message.id);
        allEmails.push({
          id: message.id,
          subject: details.subject,
          from: details.from,
          date: details.date,
          body: details.body.substring(0, 2000),
          snippet: details.snippet,
          accountName: account.name,
          refreshToken: account.refreshToken,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Small delay between accounts to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (allEmails.length === 0) {
      console.log('No inbox emails found across all accounts');
    } else {
      console.log(`Found ${allEmails.length} total inbox emails across ${accounts.length} accounts`);
    }

    return {
      ...state,
      allEmails,
      claimedEmailIds: [] as string[],
      processedIsaac: [] as any[],
      processedAmazon: [] as any[],
      processedBilling: [] as any[],
      processedInvestments: [] as any[],
      processedKickstarter: [] as any[],
      processedNewsletters: [] as any[],
      processedMarketing: [] as any[],
      processedNotifications: [] as any[],
      actionItemsMap: {} as Record<string, any[]>,
    };
  })

  // Step 2: Process ISAAC emails (highest priority - school, rock climbing, camps, etc.)
  .prompt('Identify Isaac-related emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return isaac.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: isaac.isaacIdentificationSchema,
      name: 'isaacResult' as const,
    },
  })
  .step('Process Isaac results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = isaac.processResults(unclaimed, state.isaacResult);
    const newClaimed = [...claimed, ...isaac.getClaimedIds(processed)];

    console.log(`Found ${processed.length} Isaac-related emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedIsaac: processed as any[],
    };
  })

  // Step 3: Process AMAZON emails
  .prompt('Identify Amazon emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return amazon.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: amazon.amazonIdentificationSchema,
      name: 'amazonResult' as const,
    },
  })
  .step('Process Amazon results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = amazon.processResults(unclaimed, state.amazonResult);
    const newClaimed = [...claimed, ...amazon.getClaimedIds(processed)];

    console.log(`Found ${processed.length} Amazon emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedAmazon: processed as any[],
    };
  })

  // Step 4: Process BILLING emails (receipts, invoices, subscriptions, statements)
  .prompt('Identify billing emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return billing.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: billing.billingIdentificationSchema,
      name: 'billingResult' as const,
    },
  })
  .step('Process billing results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = billing.processResults(unclaimed, state.billingResult);
    const newClaimed = [...claimed, ...billing.getClaimedIds(processed)];

    console.log(`Found ${processed.length} billing emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedBilling: processed as any[],
    };
  })

  // Step 4b: Process INVESTMENT emails
  .prompt('Identify investment emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return investments.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: investments.investmentIdentificationSchema,
      name: 'investmentsResult' as const,
    },
  })
  .step('Process investments results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = investments.processResults(unclaimed, state.investmentsResult);
    const newClaimed = [...claimed, ...investments.getClaimedIds(processed)];

    console.log(`Found ${processed.length} investment emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedInvestments: processed as any[],
    };
  })

  // Step 5: Process KICKSTARTER
  .prompt('Identify Kickstarter emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return kickstarter.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: kickstarter.kickstarterIdentificationSchema,
      name: 'kickstarterResult' as const,
    },
  })
  .step('Process Kickstarter results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = kickstarter.processResults(unclaimed, state.kickstarterResult);
    const newClaimed = [...claimed, ...kickstarter.getClaimedIds(processed)];

    console.log(`Found ${processed.length} Kickstarter emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedKickstarter: processed as any[],
    };
  })

  // Step 5: Process NEWSLETTERS
  .prompt('Identify newsletter emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return newsletters.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: newsletters.newsletterIdentificationSchema,
      name: 'newslettersResult' as const,
    },
  })
  .step('Process newsletters results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = newsletters.processResults(unclaimed, state.newslettersResult);
    const newClaimed = [...claimed, ...newsletters.getClaimedIds(processed)];

    console.log(`Found ${processed.length} newsletter emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedNewsletters: processed as any[],
    };
  })

  // Step 6: Process MARKETING emails
  .prompt('Identify marketing emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return marketing.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: marketing.marketingIdentificationSchema,
      name: 'marketingResult' as const,
    },
  })
  .step('Process marketing results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = marketing.processResults(unclaimed, state.marketingResult);
    const newClaimed = [...claimed, ...marketing.getClaimedIds(processed)];

    console.log(`Found ${processed.length} marketing emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedMarketing: processed as any[],
    };
  })

  // Step 8: Process NOTIFICATION emails (low-value product updates, policy changes, etc.)
  .prompt('Identify notification emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return notifications.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: notifications.notificationIdentificationSchema,
      name: 'notificationsResult' as const,
    },
  })
  .step('Process notifications results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = notifications.processResults(unclaimed, state.notificationsResult);
    const newClaimed = [...claimed, ...notifications.getClaimedIds(processed)];

    console.log(`Found ${processed.length} notification emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedNotifications: processed as any[],
    };
  })

  // Step 9: Extract ACTION ITEMS from all categorized emails (runs last, doesn't claim)
  .step('Collect all categorized emails for action item extraction', ({ state }) => {
    // Gather all categorized emails' raw email data
    const allCategorizedEmails: any[] = [];

    for (const email of state.processedAmazon as any[]) {
      allCategorizedEmails.push(email.rawEmail);
    }
    for (const email of state.processedBilling as any[]) {
      allCategorizedEmails.push(email.rawEmail);
    }
    for (const email of state.processedInvestments as any[]) {
      allCategorizedEmails.push(email.rawEmail);
    }
    for (const email of state.processedKickstarter as any[]) {
      allCategorizedEmails.push(email.rawEmail);
    }
    for (const email of state.processedNewsletters as any[]) {
      allCategorizedEmails.push(email.rawEmail);
    }

    console.log(`Extracting action items from ${allCategorizedEmails.length} categorized emails`);

    return {
      ...state,
      categorizedEmailsForActionItems: allCategorizedEmails,
    };
  })
  .prompt('Extract action items from categorized emails', {
    template: ({ categorizedEmailsForActionItems }) => {
      const emails = (categorizedEmailsForActionItems || []) as RawEmail[];
      return actionItems.buildExtractionPrompt(emails);
    },
    outputSchema: {
      schema: actionItems.actionItemExtractionSchema,
      name: 'actionItemsResult' as const,
    },
  })
  .step('Process action items results', ({ state }) => {
    const emails = (state.categorizedEmailsForActionItems || []) as RawEmail[];
    const actionItemsMap = actionItems.processResults(emails, state.actionItemsResult);
    const totalActionItems = actionItems.countActionItems(actionItemsMap);

    console.log(`Found ${totalActionItems} action items across ${Object.keys(actionItemsMap).length} emails`);

    return {
      ...state,
      actionItemsMap: actionItemsMap as any,
    };
  })

  // Step 10: Generate unified HTML page
  .step('Generate unified summary page', async ({ state, pages, env }) => {
    const processedData: ProcessedEmails = {
      isaac: state.processedIsaac as any[],
      amazon: state.processedAmazon as any[],
      billing: state.processedBilling as any[],
      investments: state.processedInvestments as any[],
      kickstarter: state.processedKickstarter as any[],
      newsletters: state.processedNewsletters as any[],
      marketing: state.processedMarketing as any[],
      notifications: state.processedNotifications as any[],
      actionItemsMap: state.actionItemsMap as any,
    };

    const totalEmails =
      processedData.isaac.length +
      processedData.amazon.length +
      processedData.billing.length +
      processedData.investments.length +
      processedData.kickstarter.length +
      processedData.newsletters.length +
      processedData.marketing.length +
      processedData.notifications.length;

    if (totalEmails === 0) {
      console.log('No categorized emails to display');
      return { ...state, sessionId: '', pageUrl: '' };
    }

    if (!pages) {
      throw new Error('Pages service not available');
    }

    const sessionId = crypto.randomUUID();
    const slug = `email-digest-${sessionId.slice(0, 8)}`;

    const tempHtml = '<html><body>Loading...</body></html>';
    const page = await pages.create(slug, tempHtml, { persist: false });

    const webhookUrl = `${env.origin}/webhooks/archive`;

    const html = generateUnifiedPage(processedData, sessionId, webhookUrl);
    await pages.update(slug, html);

    console.log(`Summary page created: ${page.url}`);

    return { ...state, sessionId, pageUrl: page.url };
  })

  // Step 11: Send notification
  .step('Send notification', async ({ state, ntfy }) => {
    if (!state.pageUrl) {
      console.log('No page created, skipping notification');
      return state;
    }

    const processedData: ProcessedEmails = {
      isaac: state.processedIsaac as any[],
      amazon: state.processedAmazon as any[],
      billing: state.processedBilling as any[],
      investments: state.processedInvestments as any[],
      kickstarter: state.processedKickstarter as any[],
      newsletters: state.processedNewsletters as any[],
      marketing: state.processedMarketing as any[],
      notifications: state.processedNotifications as any[],
      actionItemsMap: state.actionItemsMap as any,
    };

    // Count action items from actionItemsMap (for non-Isaac emails) + Isaac action items
    const actionItemsFromMap = actionItems.countActionItems(processedData.actionItemsMap);
    const isaacActionItems = processedData.isaac.reduce((sum, e) => sum + e.actionItems.length, 0);
    const totalActionItems = actionItemsFromMap + isaacActionItems;

    const counts = [
      processedData.isaac.length > 0 ? `${processedData.isaac.length} Isaac` : null,
      processedData.amazon.length > 0 ? `${processedData.amazon.length} Amazon` : null,
      processedData.billing.length > 0 ? `${processedData.billing.length} billing` : null,
      processedData.investments.length > 0 ? `${processedData.investments.length} investments` : null,
      processedData.kickstarter.length > 0 ? `${processedData.kickstarter.length} Kickstarter` : null,
      processedData.newsletters.length > 0 ? `${processedData.newsletters.length} newsletters` : null,
      processedData.marketing.length > 0 ? `${processedData.marketing.length} marketing` : null,
      processedData.notifications.length > 0 ? `${processedData.notifications.length} notifications` : null,
      totalActionItems > 0 ? `${totalActionItems} action items` : null,
    ].filter(Boolean);

    const message = `Email digest: ${counts.join(', ')}`;

    await ntfy.send(message, state.pageUrl as string);
    console.log(`Notification sent: ${message}`);

    return state;
  })

  // Step 12: Wait for archive confirmation
  .step('Wait for archive confirmation', ({ state }) => {
    if (!state.sessionId) {
      console.log('No session, completing without waiting');
      return state;
    }

    return {
      state,
      waitFor: [archiveWebhook(state.sessionId as string)],
    };
  })

  // Step 13: Archive selected emails (handles multiple accounts)
  .step('Archive emails', async ({ state, response, gmail }) => {
    if (!state.sessionId) {
      console.log('No emails to archive');
      return { ...state, archived: false, archivedCount: 0 };
    }

    const webhookResponse = response as { emailIds: string[]; confirmed: boolean } | undefined;

    if (!webhookResponse?.confirmed) {
      console.log('Archive not confirmed');
      return { ...state, archived: false, archivedCount: 0 };
    }

    const selectedEmailIds = new Set(webhookResponse.emailIds);
    const allEmails = state.allEmails as any[];

    // Group emails by account (refreshToken)
    const emailsByAccount: Record<string, { refreshToken: string; emailIds: string[] }> = {};

    for (const email of allEmails) {
      if (selectedEmailIds.has(email.id)) {
        const key = email.accountName;
        if (!emailsByAccount[key]) {
          emailsByAccount[key] = { refreshToken: email.refreshToken, emailIds: [] };
        }
        emailsByAccount[key].emailIds.push(email.id);
      }
    }

    let totalArchived = 0;
    for (const [accountName, { refreshToken, emailIds }] of Object.entries(emailsByAccount)) {
      console.log(`Archiving ${emailIds.length} emails from ${accountName}...`);
      await gmail.archiveMessages(refreshToken, emailIds);
      totalArchived += emailIds.length;
    }

    console.log(`Successfully archived ${totalArchived} emails across ${Object.keys(emailsByAccount).length} accounts`);

    return {
      ...state,
      archived: true,
      archivedCount: totalArchived,
    };
  });

export default emailDigestBrain;
