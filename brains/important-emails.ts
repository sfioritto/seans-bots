import { brain } from '../brain.js';
import { z } from 'zod';
import gmail from '../services/gmail.js';
import { reviewEmailsWebhook } from '../webhooks/review-emails.js';

// Important senders to watch for
const IMPORTANT_SENDERS = [
  'john dowd',
  'joe driscoll',
  'chantelle dusay',
];

// Get today's date for deadline checking
function getTodayDateString(): string {
  const today = new Date();
  return today.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const importantEmailsBrain = brain({
  title: 'important-emails',
  description: 'Scans all email accounts to find important emails from key contacts or with today\'s deadlines',
})
  // Step 1: Fetch emails from all accounts
  .step('Fetch emails from all accounts', async ({ state }) => {
    const accounts = gmail.getAccounts();

    if (accounts.length === 0) {
      console.log('No Gmail accounts configured');
      return {
        ...state,
        emails: [],
        accountInfo: [],
      };
    }

    console.log(`Fetching emails from ${accounts.length} accounts...`);

    const emails: Array<{
      id: string;
      accountIndex: number;
      accountName: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body: string;
    }> = [];

    const accountInfo: Array<{ index: number; name: string; refreshToken: string }> = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      accountInfo.push({
        index: i,
        name: account.name,
        refreshToken: account.refreshToken,
      });

      // Get recent inbox emails
      const messages = await gmail.searchMessages(account.refreshToken, 'label:inbox', 50);
      console.log(`Found ${messages.length} emails in ${account.name}`);

      for (const message of messages) {
        const details = await gmail.getMessageDetails(account.refreshToken, message.id);
        emails.push({
          id: message.id,
          accountIndex: i,
          accountName: account.name,
          subject: details.subject,
          from: details.from,
          date: details.date,
          snippet: details.snippet,
          body: details.body.substring(0, 3000), // Limit body size
        });

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Delay between accounts
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log(`Total emails to scan: ${emails.length}`);

    return {
      ...state,
      emails,
      accountInfo,
      todayDate: getTodayDateString(),
    };
  })

  // Step 2: Use a loop to let the LLM analyze emails and find important ones
  .loop('Find important emails', ({ state, ntfy, pages, env }) => {
    const emails = (state.emails || []) as Array<{
      id: string;
      accountIndex: number;
      accountName: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body: string;
    }>;

    const todayDate = state.todayDate as string;

    // Build a summary of all emails for the LLM
    const emailSummaries = emails.map((email, index) => ({
      index,
      id: email.id,
      account: email.accountName,
      from: email.from,
      subject: email.subject,
      date: email.date,
      snippet: email.snippet,
    }));

    return {
      system: `You are an email assistant helping to identify important emails.

Today's date is: ${todayDate}

IMPORTANT SENDERS to watch for (case-insensitive match on sender name):
${IMPORTANT_SENDERS.map((s) => `- ${s}`).join('\n')}

An email is IMPORTANT if:
1. It's from one of the important senders listed above (check the "from" field for their name)
2. OR it mentions a deadline, due date, or action required TODAY (${todayDate})

Your job is to review the email list and identify which ones are important.`,

      prompt: `Here are the emails to analyze:

${JSON.stringify(emailSummaries, null, 2)}

Please analyze each email and use the tools to:
1. Use "get_email_details" if you need to see the full body of an email to determine if it has a deadline today
2. Use "mark_important" for each email you determine is important, providing a reason
3. After finding important emails, use "escalate_for_review" to pause and let the user review them
4. After the user responds (you'll receive their action as a tool result):
   - If action is "draft_response": Use "draft_response" for each important email to draft a reply, then use "finish"
   - If action is "acknowledge" or "dismiss": Use "finish" directly

IMPORTANT: If you find any important emails, you MUST use "escalate_for_review" before finishing. This pauses the workflow and waits for user confirmation.

Start by scanning the sender names for matches with the important senders list, then check subjects/snippets for deadline mentions.`,

      tools: {
        get_email_details: {
          description: 'Get the full body of an email to check for deadline mentions',
          inputSchema: z.object({
            emailIndex: z.number().describe('Index of the email in the list'),
          }),
          execute: async (input: { emailIndex: number }) => {
            const email = emails[input.emailIndex];
            if (!email) {
              return { error: 'Email not found' };
            }
            return {
              index: input.emailIndex,
              from: email.from,
              subject: email.subject,
              date: email.date,
              body: email.body,
            };
          },
        },

        mark_important: {
          description: 'Mark an email as important with a reason',
          inputSchema: z.object({
            emailIndex: z.number().describe('Index of the email in the list'),
            reason: z.string().describe('Why this email is important (sender match or deadline today)'),
          }),
          execute: async (input: { emailIndex: number; reason: string }) => {
            const email = emails[input.emailIndex];
            if (!email) {
              return { error: 'Email not found' };
            }
            return {
              marked: true,
              email: {
                id: email.id,
                account: email.accountName,
                from: email.from,
                subject: email.subject,
                date: email.date,
              },
              reason: input.reason,
            };
          },
        },

        escalate_for_review: {
          description: 'When you have found important emails, use this tool to escalate them to the user for review. The loop will pause and wait for the user to respond via webhook before continuing.',
          inputSchema: z.object({
            importantEmailIndices: z.array(z.number()).describe('Indices of the important emails found'),
            summary: z.string().describe('Brief summary for the user about what was found'),
          }),
          execute: async (input: { importantEmailIndices: number[]; summary: string }) => {
            // Generate a unique session ID for this review
            const sessionId = crypto.randomUUID();

            // Build the list of important emails for the page
            const importantEmails = input.importantEmailIndices.map((idx) => {
              const email = emails[idx];
              return email ? {
                from: email.from,
                subject: email.subject,
                date: email.date,
                snippet: email.snippet,
              } : null;
            }).filter(Boolean);

            console.log(`\n📧 Escalating ${importantEmails.length} important emails for review`);
            console.log(`Session ID: ${sessionId}`);
            console.log(input.summary);

            // Create the review page
            if (!pages) {
              throw new Error('Pages service not available');
            }

            const webhookUrl = `${env.origin}/webhooks/review-emails`;
            const slug = `review-emails-${sessionId.slice(0, 8)}`;

            const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Important Emails</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .card { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .email-from { font-weight: 600; color: #333; }
    .email-subject { color: #666; margin: 4px 0; }
    .email-snippet { font-size: 14px; color: #888; }
    .email-date { font-size: 12px; color: #aaa; }
    .summary { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 12px; margin-bottom: 20px; border-radius: 4px; }
    .actions { display: flex; gap: 12px; margin-top: 20px; }
    button { flex: 1; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
    .btn-draft { background: #4caf50; color: white; }
    .btn-ack { background: #2196f3; color: white; }
    .btn-dismiss { background: #9e9e9e; color: white; }
    button:hover { opacity: 0.9; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>📧 Important Emails Found</h1>
  <div class="summary">${input.summary}</div>

  ${importantEmails.map(email => `
  <div class="card">
    <div class="email-from">${email?.from}</div>
    <div class="email-subject">${email?.subject}</div>
    <div class="email-snippet">${email?.snippet}</div>
    <div class="email-date">${email?.date}</div>
  </div>
  `).join('')}

  <div class="actions">
    <form method="POST" action="${webhookUrl}" style="flex:1">
      <input type="hidden" name="sessionId" value="${sessionId}">
      <input type="hidden" name="action" value="draft_response">
      <button type="submit" class="btn-draft" style="width:100%">Draft Response</button>
    </form>
    <form method="POST" action="${webhookUrl}" style="flex:1">
      <input type="hidden" name="sessionId" value="${sessionId}">
      <input type="hidden" name="action" value="acknowledge">
      <button type="submit" class="btn-ack" style="width:100%">Acknowledge</button>
    </form>
    <form method="POST" action="${webhookUrl}" style="flex:1">
      <input type="hidden" name="sessionId" value="${sessionId}">
      <input type="hidden" name="action" value="dismiss">
      <button type="submit" class="btn-dismiss" style="width:100%">Dismiss</button>
    </form>
  </div>
</body>
</html>`;

            await pages.create(slug, html, { persist: false });
            const pageUrl = `${env.origin}/pages/${slug}`;

            // Send notification with link to the page
            const notificationMessage = `📧 ${importantEmails.length} important email(s) found! Tap to review.`;
            await ntfy.send(notificationMessage, pageUrl);

            // Return waitFor to suspend the loop
            return {
              waitFor: reviewEmailsWebhook(sessionId),
              sessionId,
              escalatedEmails: input.importantEmailIndices,
              summary: input.summary,
              pageUrl,
            };
          },
        },

        draft_response: {
          description: 'Draft a response to an important email. Use this when the user chose "draft_response" action. The draft will be logged to console.',
          inputSchema: z.object({
            emailIndex: z.number().describe('Index of the email to respond to'),
            draftSubject: z.string().describe('Subject line for the response'),
            draftBody: z.string().describe('Body of the draft response'),
          }),
          execute: async (input: { emailIndex: number; draftSubject: string; draftBody: string }) => {
            const email = emails[input.emailIndex];
            if (!email) {
              return { error: 'Email not found' };
            }

            console.log('\n📝 ===== DRAFT RESPONSE =====');
            console.log(`To: ${email.from}`);
            console.log(`Subject: ${input.draftSubject}`);
            console.log('---');
            console.log(input.draftBody);
            console.log('===== END DRAFT =====\n');

            return {
              drafted: true,
              to: email.from,
              subject: input.draftSubject,
              body: input.draftBody,
            };
          },
        },

        finish: {
          description: 'Complete the analysis after processing the user\'s chosen action. Call this after handling draft_response, acknowledge, or dismiss.',
          inputSchema: z.object({
            importantEmails: z.array(z.object({
              emailIndex: z.number(),
              reason: z.string(),
            })).describe('List of important emails with their indices and reasons'),
            userAction: z.enum(['acknowledge', 'draft_response', 'dismiss']).describe('The action the user chose'),
            draftedResponses: z.number().optional().describe('Number of responses drafted, if user chose draft_response'),
            summary: z.string().describe('Brief summary including what the user decided and any actions taken'),
          }),
          terminal: true,
        },
      },
    };
  })

  // Step 3: Format and output results
  .step('Format results and handle actions', async ({ state, ntfy }) => {
    const emails = (state.emails || []) as Array<{
      id: string;
      accountIndex: number;
      accountName: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body: string;
    }>;

    // Loop terminal tool output is merged into state
    const loopState = state as typeof state & {
      importantEmails?: Array<{ emailIndex: number; reason: string }>;
      userAction?: 'acknowledge' | 'draft_response' | 'dismiss';
      draftedResponses?: number;
      summary?: string;
    };

    const importantEmails = loopState.importantEmails || [];
    const userAction = loopState.userAction || 'acknowledge';
    const draftedResponses = loopState.draftedResponses || 0;
    const summary = loopState.summary || 'No summary provided';

    console.log('\n=== Important Emails Results ===\n');
    console.log(summary);
    console.log(`User action: ${userAction}`);
    console.log('');

    if (importantEmails.length === 0) {
      console.log('No important emails found.');
      return {
        ...state,
        resultCount: 0,
        results: [],
        actionTaken: 'none',
      };
    }

    const results = importantEmails.map((item) => {
      const email = emails[item.emailIndex];
      return {
        id: email?.id,
        accountIndex: email?.accountIndex,
        account: email?.accountName || 'unknown',
        from: email?.from || 'unknown',
        subject: email?.subject || 'unknown',
        date: email?.date || 'unknown',
        reason: item.reason,
      };
    });

    for (const result of results) {
      console.log(`📧 [${result.account}] ${result.subject}`);
      console.log(`   From: ${result.from}`);
      console.log(`   Date: ${result.date}`);
      console.log(`   Reason: ${result.reason}`);
      console.log('');
    }

    // Handle user action
    if (userAction === 'dismiss') {
      console.log('User dismissed the emails. No action taken.');
      return {
        ...state,
        resultCount: results.length,
        results,
        actionTaken: 'dismissed',
      };
    }

    if (userAction === 'draft_response') {
      console.log(`User requested drafts. ${draftedResponses} response(s) drafted.`);
      await ntfy.send(`Drafted ${draftedResponses} response(s) for important emails`);

      return {
        ...state,
        resultCount: results.length,
        results,
        actionTaken: 'drafted',
        draftedResponses,
      };
    }

    // Default: acknowledge
    console.log('User acknowledged the emails.');
    await ntfy.send(`Acknowledged ${results.length} important email(s)`);

    return {
      ...state,
      resultCount: results.length,
      results,
      actionTaken: 'acknowledged',
    };
  });

export default importantEmailsBrain;
