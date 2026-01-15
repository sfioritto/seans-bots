import { brain } from '../brain.js';
import { z } from 'zod';
import gmail from '../services/gmail.js';
import reviewEmailsWebhook from '../webhooks/review-emails.js';

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
  // Step 1: Fetch threads from all accounts
  .step('Fetch threads from all accounts', async ({ state }) => {
    const accounts = gmail.getAccounts();

    if (accounts.length === 0) {
      console.log('No Gmail accounts configured');
      return {
        ...state,
        threads: [],
        accountInfo: [],
      };
    }

    console.log(`Fetching threads from ${accounts.length} accounts...`);

    const threads: Array<{
      threadId: string;
      accountIndex: number;
      accountName: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body: string;
      messageIds: string[];
    }> = [];

    const accountInfo: Array<{ index: number; name: string; refreshToken: string }> = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      accountInfo.push({
        index: i,
        name: account.name,
        refreshToken: account.refreshToken,
      });

      // Get recent inbox threads
      const threadResults = await gmail.searchThreads(account.refreshToken, 'label:inbox', 50);
      console.log(`Found ${threadResults.length} threads in ${account.name}`);

      for (const thread of threadResults) {
        const details = await gmail.getThreadDetails(account.refreshToken, thread.threadId);
        threads.push({
          threadId: thread.threadId,
          accountIndex: i,
          accountName: account.name,
          subject: details.subject,
          from: details.from,
          date: details.date,
          snippet: details.snippet,
          body: details.body.substring(0, 3000), // Limit body size
          messageIds: details.messageIds,
        });

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Delay between accounts
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    console.log(`Total threads to scan: ${threads.length}`);

    return {
      ...state,
      threads,
      accountInfo,
      todayDate: getTodayDateString(),
    };
  })

  // Step 2: Use a loop to let the LLM analyze threads and find important ones
  .loop('Find important threads', ({ state, ntfy, pages, env }) => {
    const threads = (state.threads || []) as Array<{
      threadId: string;
      accountIndex: number;
      accountName: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body: string;
      messageIds: string[];
    }>;

    const todayDate = state.todayDate as string;

    // Build a summary of all threads for the LLM
    const threadSummaries = threads.map((thread, index) => ({
      index,
      threadId: thread.threadId,
      account: thread.accountName,
      from: thread.from,
      subject: thread.subject,
      date: thread.date,
      snippet: thread.snippet,
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

      prompt: `Here are the email threads to analyze:

${JSON.stringify(threadSummaries, null, 2)}

Please analyze each thread and use the tools to:
1. Use "get_thread_details" if you need to see the full body of a thread to determine if it has a deadline today
2. Use "mark_important" for each thread you determine is important, providing a reason
3. After finding important threads, use "escalate_for_review" to pause and let the user review them
4. After the user responds (you'll receive their action as a tool result):
   - If action is "draft_response": Use "draft_response" for each important thread to draft a reply, then use "finish"
   - If action is "acknowledge" or "dismiss": Use "finish" directly

IMPORTANT: If you find any important threads, you MUST use "escalate_for_review" before finishing. This pauses the workflow and waits for user confirmation.

Start by scanning the sender names for matches with the important senders list, then check subjects/snippets for deadline mentions.`,

      tools: {
        get_thread_details: {
          description: 'Get the full body of a thread to check for deadline mentions',
          inputSchema: z.object({
            threadIndex: z.number().describe('Index of the thread in the list'),
          }),
          execute: async (input: { threadIndex: number }) => {
            const thread = threads[input.threadIndex];
            if (!thread) {
              return { error: 'Thread not found' };
            }
            return {
              index: input.threadIndex,
              from: thread.from,
              subject: thread.subject,
              date: thread.date,
              body: thread.body,
            };
          },
        },

        mark_important: {
          description: 'Mark a thread as important with a reason',
          inputSchema: z.object({
            threadIndex: z.number().describe('Index of the thread in the list'),
            reason: z.string().describe('Why this thread is important (sender match or deadline today)'),
          }),
          execute: async (input: { threadIndex: number; reason: string }) => {
            const thread = threads[input.threadIndex];
            if (!thread) {
              return { error: 'Thread not found' };
            }
            return {
              marked: true,
              thread: {
                threadId: thread.threadId,
                account: thread.accountName,
                from: thread.from,
                subject: thread.subject,
                date: thread.date,
              },
              reason: input.reason,
            };
          },
        },

        escalate_for_review: {
          description: 'When you have found important threads, use this tool to escalate them to the user for review. The loop will pause and wait for the user to respond via webhook before continuing.',
          inputSchema: z.object({
            importantThreadIndices: z.array(z.number()).describe('Indices of the important threads found'),
            summary: z.string().describe('Brief summary for the user about what was found'),
          }),
          execute: async (input: { importantThreadIndices: number[]; summary: string }) => {
            // Generate a unique session ID for this review
            const sessionId = crypto.randomUUID();

            // Build the list of important threads for the page
            const importantThreads = input.importantThreadIndices.map((idx) => {
              const thread = threads[idx];
              return thread ? {
                from: thread.from,
                subject: thread.subject,
                date: thread.date,
                snippet: thread.snippet,
              } : null;
            }).filter(Boolean);

            console.log(`\n📧 Escalating ${importantThreads.length} important threads for review`);
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

  ${importantThreads.map(thread => `
  <div class="card">
    <div class="email-from">${thread?.from}</div>
    <div class="email-subject">${thread?.subject}</div>
    <div class="email-snippet">${thread?.snippet}</div>
    <div class="email-date">${thread?.date}</div>
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
            const notificationMessage = `📧 ${importantThreads.length} important thread(s) found! Tap to review.`;
            await ntfy.send(notificationMessage, pageUrl);

            // Return waitFor to suspend the loop
            return {
              waitFor: reviewEmailsWebhook(sessionId),
              sessionId,
              escalatedThreads: input.importantThreadIndices,
              summary: input.summary,
              pageUrl,
            };
          },
        },

        draft_response: {
          description: 'Draft a response to an important thread. Use this when the user chose "draft_response" action. The draft will be logged to console.',
          inputSchema: z.object({
            threadIndex: z.number().describe('Index of the thread to respond to'),
            draftSubject: z.string().describe('Subject line for the response'),
            draftBody: z.string().describe('Body of the draft response'),
          }),
          execute: async (input: { threadIndex: number; draftSubject: string; draftBody: string }) => {
            const thread = threads[input.threadIndex];
            if (!thread) {
              return { error: 'Thread not found' };
            }

            console.log('\n📝 ===== DRAFT RESPONSE =====');
            console.log(`To: ${thread.from}`);
            console.log(`Subject: ${input.draftSubject}`);
            console.log('---');
            console.log(input.draftBody);
            console.log('===== END DRAFT =====\n');

            return {
              drafted: true,
              to: thread.from,
              subject: input.draftSubject,
              body: input.draftBody,
            };
          },
        },

        finish: {
          description: 'Complete the analysis after processing the user\'s chosen action. Call this after handling draft_response, acknowledge, or dismiss.',
          inputSchema: z.object({
            importantThreads: z.array(z.object({
              threadIndex: z.number(),
              reason: z.string(),
            })).describe('List of important threads with their indices and reasons'),
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
    const threads = (state.threads || []) as Array<{
      threadId: string;
      accountIndex: number;
      accountName: string;
      subject: string;
      from: string;
      date: string;
      snippet: string;
      body: string;
      messageIds: string[];
    }>;

    // Loop terminal tool output is merged into state
    const loopState = state as typeof state & {
      importantThreads?: Array<{ threadIndex: number; reason: string }>;
      userAction?: 'acknowledge' | 'draft_response' | 'dismiss';
      draftedResponses?: number;
      summary?: string;
    };

    const importantThreads = loopState.importantThreads || [];
    const userAction = loopState.userAction || 'acknowledge';
    const draftedResponses = loopState.draftedResponses || 0;
    const summary = loopState.summary || 'No summary provided';

    console.log('\n=== Important Threads Results ===\n');
    console.log(summary);
    console.log(`User action: ${userAction}`);
    console.log('');

    if (importantThreads.length === 0) {
      console.log('No important threads found.');
      return {
        ...state,
        resultCount: 0,
        results: [],
        actionTaken: 'none',
      };
    }

    const results = importantThreads.map((item) => {
      const thread = threads[item.threadIndex];
      return {
        threadId: thread?.threadId,
        accountIndex: thread?.accountIndex,
        account: thread?.accountName || 'unknown',
        from: thread?.from || 'unknown',
        subject: thread?.subject || 'unknown',
        date: thread?.date || 'unknown',
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
      console.log('User dismissed the threads. No action taken.');
      return {
        ...state,
        resultCount: results.length,
        results,
        actionTaken: 'dismissed',
      };
    }

    if (userAction === 'draft_response') {
      console.log(`User requested drafts. ${draftedResponses} response(s) drafted.`);
      await ntfy.send(`Drafted ${draftedResponses} response(s) for important threads`);

      return {
        ...state,
        resultCount: results.length,
        results,
        actionTaken: 'drafted',
        draftedResponses,
      };
    }

    // Default: acknowledge
    console.log('User acknowledged the threads.');
    await ntfy.send(`Acknowledged ${results.length} important thread(s)`);

    return {
      ...state,
      resultCount: results.length,
      results,
      actionTaken: 'acknowledged',
    };
  });

export default importantEmailsBrain;
