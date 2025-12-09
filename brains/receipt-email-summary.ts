import { brain } from '../brain.js';
import { z } from 'zod';
import { archiveWebhook } from '../webhooks/archive.js';

const receiptIdentificationSchema = z.object({
  receiptEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isReceipt: z.boolean().describe('Whether this email is a receipt or payment notification'),
    })
  ),
});

const emailSummarySchema = z.object({
  emailSummaries: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      merchant: z.string().describe('The merchant or company name'),
      summary: z.string().describe('One sentence summary of the purchase'),
      charges: z.array(
        z.object({
          description: z.string().describe('Description of the charge or item'),
          amount: z.string().describe('The amount charged (e.g., "$19.99")'),
        })
      ).describe('Itemized breakdown of charges'),
    })
  ),
});

function generateHtmlPage(
  emailSummaries: Array<{
    emailId: string;
    merchant: string;
    summary: string;
    charges: Array<{ description: string; amount: string }>;
  }>,
  sessionId: string,
  webhookUrl: string
): string {
  const emailItems = emailSummaries
    .map(
      (email) => `
    <div class="email-item">
      <label class="checkbox-label">
        <input type="checkbox" name="emailIds" value="${email.emailId}" checked>
        <div class="receipt-content">
          <span class="merchant-name">${email.merchant}</span>
          <span class="summary">${email.summary}</span>
          ${
            email.charges.length > 0
              ? `<ul class="charges">
            ${email.charges.map((charge) => `<li><span class="charge-desc">${charge.description}</span><span class="charge-amount">${charge.amount}</span></li>`).join('\n            ')}
          </ul>`
              : ''
          }
        </div>
      </label>
    </div>`
    )
    .join('\n');

  const emailIds = JSON.stringify(emailSummaries.map((e) => e.emailId));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt Email Summary</title>
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
      color: #059669;
      border-bottom: 3px solid #059669;
      padding-bottom: 10px;
    }
    .summary-header {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .select-all-container {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .select-all-container label {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      font-weight: bold;
    }
    .email-item {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .checkbox-label {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      cursor: pointer;
    }
    .checkbox-label input[type="checkbox"] {
      margin-top: 3px;
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    .receipt-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .merchant-name {
      font-weight: 600;
      color: #1f2937;
    }
    .summary {
      line-height: 1.4;
      color: #6b7280;
      font-size: 0.95em;
    }
    .charges {
      margin: 8px 0 0 0;
      padding-left: 0;
      list-style: none;
      background: #f9fafb;
      border-radius: 6px;
      padding: 10px;
    }
    .charges li {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 0.9em;
      border-bottom: 1px solid #e5e7eb;
    }
    .charges li:last-child {
      border-bottom: none;
    }
    .charge-desc {
      color: #4b5563;
    }
    .charge-amount {
      font-weight: 500;
      color: #059669;
    }
    .archive-form {
      margin-top: 30px;
    }
    .archive-btn {
      background: #059669;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 1.1em;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }
    .archive-btn:hover {
      background: #047857;
    }
    .archive-btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <h1>Receipt Summary</h1>
  <div class="summary-header">
    <strong>${emailSummaries.length} receipts</strong> found
  </div>
  <form class="archive-form" action="${webhookUrl}" method="POST">
    <input type="hidden" name="sessionId" value="${sessionId}">
    <input type="hidden" name="allEmailIds" value='${emailIds}'>

    <div class="select-all-container">
      <label>
        <input type="checkbox" id="selectAll" checked onchange="toggleAll(this.checked)">
        Select All
      </label>
    </div>

    ${emailItems}

    <button type="submit" class="archive-btn">Archive Selected Emails</button>
  </form>

  <script>
    function toggleAll(checked) {
      document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
        cb.checked = checked;
      });
    }

    document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const all = document.querySelectorAll('input[name="emailIds"]');
        const checked = document.querySelectorAll('input[name="emailIds"]:checked');
        document.getElementById('selectAll').checked = all.length === checked.length;
      });
    });

    document.querySelector('form').addEventListener('submit', function(e) {
      const checkedIds = Array.from(document.querySelectorAll('input[name="emailIds"]:checked'))
        .map(cb => cb.value);

      document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
        cb.disabled = true;
      });

      const hiddenField = document.createElement('input');
      hiddenField.type = 'hidden';
      hiddenField.name = 'emailIds';
      hiddenField.value = JSON.stringify(checkedIds);
      this.appendChild(hiddenField);
    });
  </script>
</body>
</html>`;
}

const receiptEmailSummaryBrain = brain('receipt-email-summary')
  .step('Fetch all inbox emails', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();
    const account2 = accounts.find((a) => a.name === 'account2');

    if (!account2) {
      console.log('No account2 configured');
      return {
        ...state,
        allEmails: [] as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[],
        refreshToken: '',
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
    };
  })
  .prompt('Identify receipt emails', {
    template: ({ allEmails }) => {
      if (!allEmails || (allEmails as any[]).length === 0) {
        return 'No emails to analyze. Return an empty receiptEmails array.';
      }

      const emails = allEmails as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[];

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

      return `You are identifying receipt and payment notification emails from a list of inbox emails.

For each email, determine if it is a receipt or payment notification. Receipts include:
- Purchase receipts from online or physical stores
- Order confirmations with payment amounts
- Subscription payment notifications
- Bill payment confirmations
- Credit card transaction alerts
- PayPal, Venmo, or other payment service notifications
- Ride-share receipts (Uber, Lyft)
- Food delivery receipts (DoorDash, UberEats, Grubhub)
- Digital purchase receipts (App Store, Google Play, Steam)
- Invoice payments
- Donation receipts

DO NOT include:
- Shipping notifications without payment details
- Marketing emails or promotions
- Account statements (unless they show a specific transaction)
- Password resets or security alerts
- Newsletters
- Personal emails

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID and whether it is a receipt.`;
    },
    outputSchema: {
      schema: receiptIdentificationSchema,
      name: 'receiptIdentification' as const,
    },
  })
  .step('Filter to receipt emails', ({ state }) => {
    const receiptEmailIds = state.receiptIdentification.receiptEmails
      .filter((e) => e.isReceipt)
      .map((e) => e.emailId);

    const receiptEmails = state.allEmails.filter((e) => receiptEmailIds.includes(e.id));

    console.log(`Identified ${receiptEmails.length} receipt emails`);

    return {
      ...state,
      receiptEmailIds,
      receiptEmails,
    };
  })
  .prompt('Summarize receipt emails', {
    template: ({ receiptEmails }) => {
      if (!receiptEmails || (receiptEmails as any[]).length === 0) {
        return 'No receipt emails to summarize. Return an empty emailSummaries array.';
      }

      const emails = receiptEmails as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[];

      const emailDetails = emails
        .map(
          (email, index) => `
Email ${index + 1}:
ID: ${email.id}
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Snippet: ${email.snippet}
Body:
${email.body}
---`
        )
        .join('\n');

      return `You are summarizing receipt emails for a busy person.

For each email, provide:
1. The MERCHANT name (e.g., "Amazon", "Uber", "Starbucks")
2. A ONE SENTENCE summary of what was purchased
3. An ITEMIZED BREAKDOWN of all charges

SUMMARY GUIDELINES:
- Keep summaries to exactly ONE sentence
- Focus on what was purchased, not payment details
- Examples:
  - "Ordered kitchen supplies and cleaning products"
  - "Ride from downtown to the airport"
  - "Monthly subscription renewal"

CHARGES GUIDELINES:
- List each line item or charge separately
- Include the amount for each item
- If there's a total, include it as the last item
- Include taxes, fees, tips if shown separately
- Format amounts with dollar sign (e.g., "$19.99")
- Examples:
  - { description: "Grande Latte", amount: "$5.95" }
  - { description: "Service Fee", amount: "$2.00" }
  - { description: "Total", amount: "$45.99" }

Here are ${emails.length} receipt emails to summarize:

${emailDetails}

Return a merchant name, one-sentence summary, and itemized charges for each email.`;
    },
    outputSchema: {
      schema: emailSummarySchema,
      name: 'emailSummaries' as const,
    },
  })
  .step('Generate summary page', async ({ state, pages }) => {
    const summaries = state.emailSummaries.emailSummaries;

    if (summaries.length === 0) {
      console.log('No receipt emails to summarize');
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
    const slug = `receipt-summary-${sessionId.slice(0, 8)}`;

    const tempHtml = '<html><body>Loading...</body></html>';
    const page = await pages.create(slug, tempHtml, { persist: false });

    const baseUrl = page.url.replace(`/pages/${slug}`, '');
    const webhookUrl = `${baseUrl}/webhooks/archive`;

    const html = generateHtmlPage(summaries, sessionId, webhookUrl);

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

    const emailCount = state.emailSummaries.emailSummaries.length;
    const message = `${emailCount} receipts ready to review`;

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

export default receiptEmailSummaryBrain;
