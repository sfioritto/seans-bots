import { brain } from '../brain.js';
import { archiveWebhook } from '../webhooks/archive.js';
import * as actionItems from './email-digest/processors/action-items.js';
import * as amazon from './email-digest/processors/amazon.js';
import * as receipts from './email-digest/processors/receipts.js';
import * as kickstarter from './email-digest/processors/kickstarter.js';
import * as newsletters from './email-digest/processors/newsletters.js';
import { generateUnifiedPage } from './email-digest/templates/unified-page.js';
import type { ProcessedEmails, RawEmail } from './email-digest/types.js';

const emailDigestBrain = brain('email-digest')
  // Step 1: Fetch ALL inbox emails once
  .step('Fetch all inbox emails', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();
    const account2 = accounts.find((a) => a.name === 'account2');

    if (!account2) {
      console.log('No account2 configured');
      return {
        ...state,
        allEmails: [] as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[],
        refreshToken: '',
        claimedEmailIds: [] as string[],
        processedAmazon: [] as any[],
        processedReceipts: [] as any[],
        processedKickstarter: [] as any[],
        processedNewsletters: [] as any[],
        actionItemsMap: {} as Record<string, any[]>,
      };
    }

    const query = 'label:inbox';
    const messages = await gmail.searchMessages(account2.refreshToken, query, 100);

    if (messages.length === 0) {
      console.log('No inbox emails found');
      return {
        ...state,
        allEmails: [] as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[],
        refreshToken: account2.refreshToken,
        claimedEmailIds: [] as string[],
        processedAmazon: [] as any[],
        processedReceipts: [] as any[],
        processedKickstarter: [] as any[],
        processedNewsletters: [] as any[],
        actionItemsMap: {} as Record<string, any[]>,
      };
    }

    console.log(`Found ${messages.length} inbox emails`);

    const allEmails: { id: string; subject: string; from: string; date: string; body: string; snippet: string }[] = [];
    for (const message of messages) {
      const details = await gmail.getMessageDetails(account2.refreshToken, message.id);
      allEmails.push({
        id: message.id,
        subject: details.subject,
        from: details.from,
        date: details.date,
        body: details.body.substring(0, 2000),
        snippet: details.snippet,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      ...state,
      allEmails,
      refreshToken: account2.refreshToken,
      claimedEmailIds: [] as string[],
      processedAmazon: [] as any[],
      processedReceipts: [] as any[],
      processedKickstarter: [] as any[],
      processedNewsletters: [] as any[],
      actionItemsMap: {} as Record<string, any[]>,
    };
  })

  // Step 2: Process AMAZON emails (first priority for categorization)
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

  // Step 3: Process RECEIPTS
  .prompt('Identify receipt emails', {
    template: ({ allEmails, claimedEmailIds }) => {
      const emails = allEmails as any[];
      const claimed = (claimedEmailIds || []) as string[];
      const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
      return receipts.buildIdentificationPrompt(unclaimed);
    },
    outputSchema: {
      schema: receipts.receiptIdentificationSchema,
      name: 'receiptsResult' as const,
    },
  })
  .step('Process receipts results', ({ state }) => {
    const emails = state.allEmails as any[];
    const claimed = (state.claimedEmailIds || []) as string[];
    const unclaimed = emails.filter((e: any) => !claimed.includes(e.id));
    const processed = receipts.processResults(unclaimed, state.receiptsResult);
    const newClaimed = [...claimed, ...receipts.getClaimedIds(processed)];

    console.log(`Found ${processed.length} receipt emails`);

    return {
      ...state,
      claimedEmailIds: newClaimed,
      processedReceipts: processed as any[],
    };
  })

  // Step 4: Process KICKSTARTER
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

  // Step 6: Extract ACTION ITEMS from all categorized emails (runs last, doesn't claim)
  .step('Collect all categorized emails for action item extraction', ({ state }) => {
    // Gather all categorized emails' raw email data
    const allCategorizedEmails: any[] = [];

    for (const email of state.processedAmazon as any[]) {
      allCategorizedEmails.push(email.rawEmail);
    }
    for (const email of state.processedReceipts as any[]) {
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

  // Step 7: Generate unified HTML page
  .step('Generate unified summary page', async ({ state, pages }) => {
    const processedData: ProcessedEmails = {
      amazon: state.processedAmazon as any[],
      receipts: state.processedReceipts as any[],
      kickstarter: state.processedKickstarter as any[],
      newsletters: state.processedNewsletters as any[],
      actionItemsMap: state.actionItemsMap as any,
    };

    const totalEmails =
      processedData.amazon.length +
      processedData.receipts.length +
      processedData.kickstarter.length +
      processedData.newsletters.length;

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

    const baseUrl = page.url.replace(`/pages/${slug}`, '');
    const webhookUrl = `${baseUrl}/webhooks/archive`;

    const html = generateUnifiedPage(processedData, sessionId, webhookUrl);
    await pages.update(slug, html);

    console.log(`Summary page created: ${page.url}`);

    return { ...state, sessionId, pageUrl: page.url };
  })

  // Step 8: Send notification
  .step('Send notification', async ({ state, ntfy }) => {
    if (!state.pageUrl) {
      console.log('No page created, skipping notification');
      return state;
    }

    const processedData: ProcessedEmails = {
      amazon: state.processedAmazon as any[],
      receipts: state.processedReceipts as any[],
      kickstarter: state.processedKickstarter as any[],
      newsletters: state.processedNewsletters as any[],
      actionItemsMap: state.actionItemsMap as any,
    };

    const totalActionItems = actionItems.countActionItems(processedData.actionItemsMap);

    const counts = [
      processedData.amazon.length > 0 ? `${processedData.amazon.length} Amazon` : null,
      processedData.receipts.length > 0 ? `${processedData.receipts.length} receipts` : null,
      processedData.kickstarter.length > 0 ? `${processedData.kickstarter.length} Kickstarter` : null,
      processedData.newsletters.length > 0 ? `${processedData.newsletters.length} newsletters` : null,
      totalActionItems > 0 ? `${totalActionItems} action items` : null,
    ].filter(Boolean);

    const message = `Email digest: ${counts.join(', ')}`;

    await ntfy.send(message, state.pageUrl as string);
    console.log(`Notification sent: ${message}`);

    return state;
  })

  // Step 9: Wait for archive confirmation
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

  // Step 10: Archive selected emails
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

    const emailIds = webhookResponse.emailIds;
    console.log(`Archiving ${emailIds.length} emails...`);

    await gmail.archiveMessages(state.refreshToken as string, emailIds);

    console.log(`Successfully archived ${emailIds.length} emails`);

    return {
      ...state,
      archived: true,
      archivedCount: emailIds.length,
    };
  });

export default emailDigestBrain;
