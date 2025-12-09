import { brain } from '../brain.js';
import { z } from 'zod';
import { archiveWebhook } from '../webhooks/archive.js';

const newsletterIdentificationSchema = z.object({
  newsletterEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isNewsletter: z.boolean().describe('Whether this email is a newsletter'),
    })
  ),
});

const emailSummarySchema = z.object({
  emailSummaries: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      newsletterName: z.string().describe('The name of the newsletter'),
      summary: z.string().describe('Two sentence summary of what the newsletter contains'),
      deadlines: z.array(z.string()).describe('List of deadlines, opportunities, or time-sensitive items mentioned'),
    })
  ),
});

function generateHtmlPage(
  emailSummaries: Array<{
    emailId: string;
    newsletterName: string;
    summary: string;
    deadlines: string[];
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
        <div class="newsletter-content">
          <span class="newsletter-name">${email.newsletterName}</span>
          <span class="summary">${email.summary}</span>
          ${
            email.deadlines.length > 0
              ? `<ul class="deadlines">
            ${email.deadlines.map((deadline) => `<li>⏰ ${deadline}</li>`).join('\n            ')}
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
  <title>Newsletter Email Summary</title>
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
      color: #6366f1;
      border-bottom: 3px solid #6366f1;
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
    .newsletter-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .newsletter-name {
      font-weight: 600;
      color: #1f2937;
    }
    .summary {
      line-height: 1.4;
      color: #6b7280;
      font-size: 0.95em;
    }
    .deadlines {
      margin: 8px 0 0 0;
      padding-left: 0;
      list-style: none;
    }
    .deadlines li {
      background: #fef3c7;
      padding: 6px 10px;
      border-radius: 4px;
      margin-bottom: 4px;
      border-left: 3px solid #f59e0b;
      font-size: 0.9em;
      color: #92400e;
    }
    .archive-form {
      margin-top: 30px;
    }
    .archive-btn {
      background: #6366f1;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 1.1em;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }
    .archive-btn:hover {
      background: #4f46e5;
    }
    .archive-btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <h1>Newsletter Summary</h1>
  <div class="summary-header">
    <strong>${emailSummaries.length} newsletters</strong> found
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

const newsletterEmailSummaryBrain = brain('newsletter-email-summary')
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

    // Search for all unarchived inbox emails
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
  .prompt('Identify newsletter emails', {
    template: ({ allEmails }) => {
      if (!allEmails || (allEmails as any[]).length === 0) {
        return 'No emails to analyze. Return an empty newsletterEmails array.';
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

      return `You are identifying newsletter emails from a list of inbox emails.

For each email, determine if it is a newsletter. Newsletters are:
- Regularly scheduled email publications sent to subscribers
- Digests, roundups, or curated content emails
- Daily/weekly/monthly updates from publications, blogs, or content creators
- Email courses or drip campaigns with educational content
- Industry news roundups or summaries
- Substack, Revue, Buttondown, or similar newsletter platforms
- Marketing emails that are primarily informational/content-focused (not transactional)

DO NOT include:
- Transactional emails (receipts, shipping notifications, password resets)
- Personal emails from individuals
- Direct marketing/promotional emails for specific products or sales
- Social media notifications
- Account alerts or security notifications
- Calendar invites or event reminders

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID and whether it is a newsletter.`;
    },
    outputSchema: {
      schema: newsletterIdentificationSchema,
      name: 'newsletterIdentification' as const,
    },
  })
  .step('Filter to newsletter emails', ({ state }) => {
    const newsletterEmailIds = state.newsletterIdentification.newsletterEmails
      .filter((e) => e.isNewsletter)
      .map((e) => e.emailId);

    const newsletterEmails = state.allEmails.filter((e) => newsletterEmailIds.includes(e.id));

    console.log(`Identified ${newsletterEmails.length} newsletter emails`);

    return {
      ...state,
      newsletterEmailIds,
      newsletterEmails,
    };
  })
  .prompt('Summarize newsletter emails', {
    template: ({ newsletterEmails }) => {
      if (!newsletterEmails || (newsletterEmails as any[]).length === 0) {
        return 'No newsletter emails to summarize. Return an empty emailSummaries array.';
      }

      const emails = newsletterEmails as { id: string; subject: string; from: string; date: string; body: string; snippet: string }[];

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

      return `You are summarizing newsletter emails for a busy person.

For each email, provide:
1. The NAME of the newsletter (e.g., "Morning Brew", "The Hustle", "Hacker Newsletter")
2. A TWO SENTENCE summary of what this edition contains/covers
3. A list of DEADLINES or time-sensitive opportunities mentioned

SUMMARY GUIDELINES:
- Keep summaries to exactly TWO sentences
- Focus on the main topics or highlights covered in this edition
- Be specific about the content, not generic descriptions
- Examples:
  - "Covers the latest AI developments including GPT-5 rumors and new open-source models. Also discusses the tech layoffs trend and what it means for developers."
  - "This week's edition focuses on productivity tips for remote workers. Features an interview with a time management expert and reviews of calendar apps."

DEADLINES GUIDELINES:
- Include any deadlines, expiring opportunities, limited-time offers, or time-sensitive items
- Include application deadlines, registration cutoffs, early bird pricing, sale end dates
- Include event dates, webinar times, conference registration deadlines
- Be specific with dates when mentioned (e.g., "Early bird pricing ends Dec 15")
- If no deadlines or time-sensitive items, return an empty array
- Examples:
  - "Conference early bird registration ends Friday"
  - "Job posting closes December 20th"
  - "Free workshop this Thursday at 2pm EST"
  - "Black Friday sale ends tonight"

Here are ${emails.length} newsletter emails to summarize:

${emailDetails}

Return a newsletter name, two-sentence summary, and any deadlines for each email.`;
    },
    outputSchema: {
      schema: emailSummarySchema,
      name: 'emailSummaries' as const,
    },
  })
  .step('Generate summary page', async ({ state, pages }) => {
    const summaries = state.emailSummaries.emailSummaries;

    if (summaries.length === 0) {
      console.log('No newsletter emails to summarize');
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
    const slug = `newsletter-summary-${sessionId.slice(0, 8)}`;

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
    const message = `${emailCount} newsletters ready to review`;

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

export default newsletterEmailSummaryBrain;
