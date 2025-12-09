import { brain } from '../brain.js';
import { z } from 'zod';
import { archiveWebhook } from '../webhooks/archive.js';

const kickstarterIdentificationSchema = z.object({
  kickstarterEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isKickstarterRelated: z.boolean().describe('Whether this email is related to a Kickstarter project'),
    })
  ),
});

const emailSummarySchema = z.object({
  emailSummaries: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      summary: z.string().describe('One sentence summary of the email'),
      actionItems: z.array(z.string()).describe('List of actions the user needs to take, if any'),
    })
  ),
});

function generateHtmlPage(
  emailSummaries: Array<{
    emailId: string;
    summary: string;
    actionItems: string[];
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
        <span class="summary">${email.summary}</span>
      </label>
      ${
        email.actionItems.length > 0
          ? `<ul class="action-items">
          ${email.actionItems.map((action) => `<li class="action-item">⚠️ ${action}</li>`).join('\n          ')}
        </ul>`
          : ''
      }
    </div>`
    )
    .join('\n');

  const emailIds = JSON.stringify(emailSummaries.map((e) => e.emailId));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kickstarter Email Summary</title>
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
      color: #05ce78;
      border-bottom: 3px solid #05ce78;
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
    .summary {
      flex: 1;
      line-height: 1.4;
    }
    .action-items {
      margin: 10px 0 0 28px;
      padding-left: 0;
      list-style: none;
    }
    .action-item {
      background: #fff3cd;
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 5px;
      border-left: 3px solid #ffc107;
      font-size: 0.9em;
    }
    .archive-form {
      margin-top: 30px;
      text-align: center;
    }
    .archive-btn {
      background: #05ce78;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 1.1em;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }
    .archive-btn:hover {
      background: #04b569;
    }
    .archive-btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <h1>Kickstarter Email Summary</h1>
  <div class="summary-header">
    <strong>${emailSummaries.length} Kickstarter-related emails</strong> found
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

    // Update select all checkbox when individual checkboxes change
    document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const all = document.querySelectorAll('input[name="emailIds"]');
        const checked = document.querySelectorAll('input[name="emailIds"]:checked');
        document.getElementById('selectAll').checked = all.length === checked.length;
      });
    });

    // Handle form submission to only include checked emails
    document.querySelector('form').addEventListener('submit', function(e) {
      const checkedIds = Array.from(document.querySelectorAll('input[name="emailIds"]:checked'))
        .map(cb => cb.value);

      // Remove individual checkboxes from form data
      document.querySelectorAll('input[name="emailIds"]').forEach(cb => {
        cb.disabled = true;
      });

      // Add a single hidden field with the checked IDs as JSON
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

const kickstarterEmailSummaryBrain = brain('kickstarter-email-summary')
  .step('Fetch all inbox emails', async ({ state, gmail }) => {
    // Get account2 (sean.fioritto@gmail.com)
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

    // Search for all unarchived inbox emails (no specific filter)
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

    // Fetch details for each email
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
  .prompt('Identify Kickstarter-related emails', {
    template: ({ allEmails }) => {
      if (!allEmails || (allEmails as any[]).length === 0) {
        return 'No emails to analyze. Return an empty kickstarterEmails array.';
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

      return `You are identifying emails related to Kickstarter campaigns and crowdfunding projects.

For each email, determine if it is related to a Kickstarter project. This includes:
- Direct emails from kickstarter.com
- Emails from BackerKit, CrowdOx, or other fulfillment platforms for Kickstarter projects
- Shipping notifications for Kickstarter-backed products
- Updates from creators about their Kickstarter projects (even if from their own domains)
- Survey requests for Kickstarter pledges
- Any other email clearly related to a crowdfunded project

DO NOT include:
- General promotional emails that just mention crowdfunding
- News articles about Kickstarter
- Unrelated emails

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID and whether it is Kickstarter-related.`;
    },
    outputSchema: {
      schema: kickstarterIdentificationSchema,
      name: 'kickstarterIdentification' as const,
    },
  })
  .step('Filter to Kickstarter emails', ({ state }) => {
    const kickstarterEmailIds = state.kickstarterIdentification.kickstarterEmails
      .filter((e) => e.isKickstarterRelated)
      .map((e) => e.emailId);

    const kickstarterEmails = state.allEmails.filter((e) => kickstarterEmailIds.includes(e.id));

    console.log(`Identified ${kickstarterEmails.length} Kickstarter-related emails`);

    return {
      ...state,
      kickstarterEmailIds,
      kickstarterEmails,
    };
  })
  .prompt('Summarize Kickstarter emails with action items', {
    template: ({ kickstarterEmails }) => {
      if (!kickstarterEmails || (kickstarterEmails as any[]).length === 0) {
        return 'No Kickstarter emails to summarize. Return an empty emailSummaries array.';
      }

      const emails = kickstarterEmails as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[];

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

      return `You are summarizing Kickstarter-related emails for a busy person.

For each email, provide:
1. A ONE SENTENCE summary of what the email is about
2. A list of ACTION ITEMS if the email requires the user to do something

ACTION ITEMS should include things like:
- Completing a backer survey
- Updating a shipping address
- Confirming add-ons or pledge amounts
- Responding to a creator question
- Making a payment or providing payment info
- Any deadline-sensitive actions

If there are no actions required, return an empty actionItems array.

SUMMARY GUIDELINES:
- Keep summaries to ONE clear sentence
- Include the project name if mentioned
- Include relevant dates if time-sensitive
- Examples:
  - "Board game project has shipped and will arrive next week"
  - "BackerKit survey for dice set project needs your shipping address"
  - "Creator posted update about manufacturing delays"

Here are ${emails.length} Kickstarter-related emails to summarize:

${emailDetails}

Return a summary and action items for each email.`;
    },
    outputSchema: {
      schema: emailSummarySchema,
      name: 'emailSummaries' as const,
    },
  })
  .step('Generate summary page', async ({ state, pages }) => {
    const summaries = state.emailSummaries.emailSummaries;

    if (summaries.length === 0) {
      console.log('No Kickstarter emails to summarize');
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
    const slug = `kickstarter-summary-${sessionId.slice(0, 8)}`;

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
    const message = `${emailCount} Kickstarter emails ready to review`;

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

export default kickstarterEmailSummaryBrain;
