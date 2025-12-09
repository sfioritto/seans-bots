import { brain } from '../brain.js';
import { z } from 'zod';
import { archiveWebhook } from '../webhooks/archive.js';

const emailCategorySchema = z.object({
  categorizedEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      subject: z.string().describe('The email subject'),
      category: z.enum([
        'order_confirmation',
        'shipping_notification',
        'delivery_notification',
        'delivery_delay',
        'billing',
        'return_refund',
        'promotional',
        'account_security',
        'other'
      ]).describe('The category of the email'),
      summary: z.string().describe('One-line summary of what this email is about'),
    })
  ),
});

const categoryLabels: Record<string, string> = {
  order_confirmation: 'Orders Placed',
  shipping_notification: 'Shipped',
  delivery_notification: 'Delivered',
  delivery_delay: 'Delays',
  billing: 'Billing',
  return_refund: 'Returns & Refunds',
  promotional: 'Promotions',
  account_security: 'Account Security',
  other: 'Other',
};

function generateHtmlPage(
  categorizedEmails: Array<{
    emailId: string;
    subject: string;
    category: string;
    summary: string;
  }>,
  sessionId: string,
  webhookUrl: string
): string {
  // Group emails by category
  const emailsByCategory: Record<string, typeof categorizedEmails> = {};
  for (const email of categorizedEmails) {
    if (!emailsByCategory[email.category]) {
      emailsByCategory[email.category] = [];
    }
    emailsByCategory[email.category].push(email);
  }

  // Build category sections
  const categorySections = Object.entries(emailsByCategory)
    .map(([category, emails]) => {
      const label = categoryLabels[category] || category;
      const emailItems = emails
        .map((email) => `<li>${email.summary}</li>`)
        .join('\n        ');
      return `
    <div class="category">
      <h2>${label}</h2>
      <ul>
        ${emailItems}
      </ul>
    </div>`;
    })
    .join('\n');

  const emailIds = JSON.stringify(categorizedEmails.map((e) => e.emailId));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Amazon Email Summary</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #232f3e;
      border-bottom: 3px solid #ff9900;
      padding-bottom: 10px;
    }
    .summary {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .category {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .category h2 {
      color: #232f3e;
      font-size: 1.1em;
      margin: 0 0 10px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
    .category ul {
      margin: 0;
      padding-left: 20px;
    }
    .category li {
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .archive-form {
      margin-top: 30px;
      text-align: center;
    }
    .archive-btn {
      background: #ff9900;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 1.1em;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }
    .archive-btn:hover {
      background: #e88b00;
    }
    .archive-btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <h1>Amazon Email Summary</h1>
  <div class="summary">
    <strong>${categorizedEmails.length} emails</strong> found from Amazon
  </div>
  ${categorySections}
  <form class="archive-form" action="${webhookUrl}" method="POST">
    <input type="hidden" name="sessionId" value="${sessionId}">
    <input type="hidden" name="emailIds" value='${emailIds}'>
    <button type="submit" class="archive-btn">Archive All ${categorizedEmails.length} Emails</button>
  </form>
</body>
</html>`;
}

const amazonEmailSummaryBrain = brain('amazon-email-summary')
  .step('Fetch unread Amazon emails', async ({ state, gmail }) => {
    // Get account2 (sean.fioritto@gmail.com)
    const accounts = gmail.getAccounts();
    const account2 = accounts.find((a) => a.name === 'account2');

    if (!account2) {
      console.log('No account2 configured');
      return {
        ...state,
        amazonEmails: [] as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[],
        refreshToken: '',
      };
    }

    // Search for unread, unarchived Amazon emails
    const query = 'label:inbox is:unread from:amazon.com';
    const messages = await gmail.searchMessages(account2.refreshToken, query, 100);

    if (messages.length === 0) {
      console.log('No unread Amazon emails found');
      return {
        ...state,
        amazonEmails: [] as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[],
        refreshToken: account2.refreshToken,
      };
    }

    console.log(`Found ${messages.length} unread Amazon emails`);

    // Fetch details for each email
    const amazonEmails: { id: string; subject: string; from: string; date: string; body: string; snippet: string }[] = [];
    for (const message of messages) {
      const details = await gmail.getMessageDetails(account2.refreshToken, message.id);
      amazonEmails.push({
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
      amazonEmails,
      refreshToken: account2.refreshToken,
    };
  })
  .prompt('Categorize emails', {
    template: ({ amazonEmails }) => {
      if (!amazonEmails || (amazonEmails as any[]).length === 0) {
        return 'No emails to categorize. Return an empty categorizedEmails array.';
      }

      const emails = amazonEmails as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[];

      const emailSummaries = emails
        .map(
          (email, index) => `
Email ${index + 1}:
ID: ${email.id}
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Snippet: ${email.snippet}
Body Preview:
${email.body}
---`
        )
        .join('\n');

      return `You are categorizing Amazon emails. For each email, determine:
1. The category (order_confirmation, shipping_notification, delivery_notification, delivery_delay, billing, return_refund, promotional, account_security, other)
2. A one-line summary suitable for a notification

CATEGORY DEFINITIONS:
- order_confirmation: New order placed, order confirmed
- shipping_notification: Package has shipped, tracking available
- delivery_notification: Package delivered, delivery confirmed
- delivery_delay: Delivery is delayed, rescheduled
- billing: Payment issues, invoice, credit card, charges
- return_refund: Return processed, refund issued
- promotional: Marketing, deals, Prime offers, recommendations
- account_security: Password changes, login alerts, verification
- other: Anything else

SUMMARY GUIDELINES:
- Keep summaries to ONE short sentence
- Include the key item/product name if mentioned
- Include relevant dates or amounts if important
- Examples: "AirPods Pro delivered", "Order shipped: Kitchen Scale", "$47.99 charged for Prime"

Here are ${emails.length} Amazon emails to categorize:

${emailSummaries}

Return the categorization for each email.`;
    },
    outputSchema: {
      schema: emailCategorySchema,
      name: 'emailCategories' as const,
    },
  })
  .step('Generate summary page', async ({ state, pages }) => {
    const categorizedEmails = state.emailCategories.categorizedEmails;

    if (categorizedEmails.length === 0) {
      console.log('No emails to summarize');
      return {
        ...state,
        sessionId: '',
        pageUrl: '',
      };
    }

    if (!pages) {
      throw new Error('Pages service not available');
    }

    const sessionId = crypto.randomUUID();
    const slug = `amazon-summary-${sessionId.slice(0, 8)}`;

    const tempHtml = '<html><body>Loading...</body></html>';
    const page = await pages.create(slug, tempHtml, { persist: false });

    const baseUrl = page.url.replace(`/pages/${slug}`, '');
    const webhookUrl = `${baseUrl}/webhooks/archive`;

    const html = generateHtmlPage(categorizedEmails, sessionId, webhookUrl);

    await pages.update(slug, html);

    console.log(`Summary page created: ${page.url}`);

    return {
      ...state,
      sessionId,
      pageUrl: page.url,
    };
  })
  .step('Send notification', async ({ state, ntfy }) => {
    if (!state.pageUrl) {
      console.log('No page created, skipping notification');
      return state;
    }

    const emailCount = state.emailCategories.categorizedEmails.length;
    const message = `${emailCount} Amazon emails ready to review`;

    await ntfy.send(message, state.pageUrl);
    console.log(`Notification sent: ${message}`);

    return state;
  })
  .step('Wait for archive confirmation', ({ state }) => {
    if (!state.sessionId) {
      console.log('No session, completing without waiting');
      return state;
    }

    return {
      state,
      waitFor: [archiveWebhook(state.sessionId)],
    };
  })
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

    await gmail.archiveMessages(state.refreshToken, emailIds);

    console.log(`Successfully archived ${emailIds.length} emails`);

    return {
      ...state,
      archived: true,
      archivedCount: emailIds.length,
    };
  });

export default amazonEmailSummaryBrain;
