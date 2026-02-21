import { brain } from '../brain.js';
import { z } from 'zod';
import gmail from '../services/gmail.js';
import ntfy from '../services/ntfy.js';

const IMPORTANT_SENDERS = [
  'john dowd',
  'joe driscoll',
  'chantelle dusay',
  'beth fioritto',
  'aaron rife',
  'mike bain',
  'jason bryan',
  'johnny korenek',
  'gary smith',
];

// Thread type for batch processing
interface ThreadForAnalysis {
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  messageCount: number;
  messageIds: string[];
  accountName: string;
  refreshToken: string;
  today: string;
  importantSenders: string[];
}

export default brain('important-emails')
  // Step 1: Initialize with today's date
  .step('Initialize', ({ state }) => ({
    today: new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    importantSenders: IMPORTANT_SENDERS,
  }))

  // Step 2: Fetch threads from all accounts
  .step('Fetch threads', async ({ state }) => {
    const accounts = gmail.getAccounts();
    const threads = [] as ThreadForAnalysis[];

    for (const account of accounts) {
      const summaries = await gmail.searchThreads(account.refreshToken, 'is:unread in:inbox');
      for (const s of summaries) {
        const details = await gmail.getThreadDetails(account.refreshToken, s.threadId);
        threads.push({
          ...details,
          accountName: account.name,
          refreshToken: account.refreshToken,
          today: state.today,
          importantSenders: state.importantSenders,
        });
      }
    }

    return { ...state, threads };
  })

  // Step 3: Cheap sender check - only sends the From field to the LLM
  .prompt(
    'Check sender',
    {
      template: (thread: ThreadForAnalysis) => `
Important senders (case-insensitive): ${thread.importantSenders.join(', ')}

From: ${thread.from}

Does the sender's name match one of the important senders (case-insensitive)?
Also flag senders from .mil or sofwarellc.com email addresses.
`,
      outputSchema: {
        schema: z.object({
          isImportantSender: z.boolean(),
          reason: z.string(),
        }),
        name: 'senderChecks' as const,
      },
    },
    {
      over: (state) => state.threads,
    }
  )

  // Step 4: Filter to important senders only
  .step('Filter by sender', ({ state }) => {
    const filteredThreads = (state.senderChecks as [ThreadForAnalysis, { isImportantSender: boolean; reason: string }][])
      .filter(([_, check]) => check.isImportantSender)
      .map(([thread]) => thread);
    filteredThreads.map((thread) => {
      console.log(thread.subject);
    })
    return { ...state, filteredThreads };
  })

  // Step 5: Full content analysis on filtered threads only
  .prompt(
    'Analyze thread',
    {
      template: (thread: ThreadForAnalysis) => `
Today's date: ${thread.today}

Email:
From: ${thread.from}
Subject: ${thread.subject}
Date: ${thread.date}
Snippet: ${thread.snippet}
Body: ${thread.body}

I am Sean Fioritto. I'm the head of product for FORGE, a software product owned by SOFware LLC. We're a small company and so I wear a lot of hats.

I want you to help me decide if this email is important.

Is this email important? An email is important if it contains any of the following:
   a. An action item or request, implied or otherwise, directed at me that I need to do something about, OR
   b. A question from someone that needs my response

Emails that should NOT be flagged as important:
- Confirmations, acknowledgments, or "thanks/got it" replies
- Status updates that don't require my input
- Someone telling me what THEY will do (no action needed from me)
- Marketing, notifications, or automated messages

Please also include a summary of the thread written for me (Sean Fioritto). The summary should explain what's happening and what I specifically need to do about it. Important: I may not be the original recipient of the email. If the email is addressed to someone else, don't write the summary as if I'm that person. Instead, mention who the email is addressed to and explain why it's relevant to me.

If you can't easily figure out what I, Sean Fioritto, need to do in this thread that's a good sign it's not important.

If you think, "Sean Fioritto needs to know about this, because it's from an important sender and it seems like he should either follow up internally with someone to discuss this or he needs to respond directly" then it's important.
`,
      outputSchema: {
        schema: z.object({
          isImportant: z.boolean(),
          reason: z.string(),
          summaryOfTheThread: z.string(),
        }),
        name: 'analyses' as const,
      },
    },
    {
      over: (state) => state.filteredThreads,
    }
  )

  // Step 6: Filter to important only
  .step('Filter important', ({ state }) => {
    const importantThreads = state.analyses
      .filter(([_, analysis]) => analysis.isImportant)
      .map(([thread, analysis]) => ({ ...thread, reason: analysis.reason, summaryOfTheThread: analysis.summaryOfTheThread }));

    return { ...state, importantThreads };
  })

  .guard(({ state }) => state.importantThreads.length > 0, 'Has important emails')

  .ui('Review emails', {
    template: (state) => `
Create a page showing important unread emails that the user can select to mark as read.

Display each email as a card with:
- A checkbox to select it (use the thread ID as the checkbox value)
- The sender and subject
- Summary of the thread (the summaryOfTheThread)

Emails to display:
${state.importantThreads.map((t: any) => `
- ID: ${t.threadId}
- From: ${t.from}
- Subject: ${t.subject}
- Date: ${t.date}
- Summary of the thread: ${t.summaryOfTheThread}
`).join('\n')}

Include a "Mark Selected as Read" submit button at the bottom.
Make it look clean and modern with good spacing.
`,
    responseSchema: z.object({
      selectedThreadIds: z.array(z.string()).describe('Array of thread IDs that were selected'),
    }),
  })

  .wait('Notify and wait for selection', async ({ state, page }) => {
    await ntfy.send(`📧 ${state.importantThreads.length} important emails`, page.url);
    return page.webhook;
  })

  .step('Handle response', async ({ state, response }) => {
    let markedCount = 0;
    const importantThreads = (state as any).importantThreads as Array<ThreadForAnalysis & { reason: string }>;
    const selectedIds = response?.selectedThreadIds || [];

    for (const thread of importantThreads) {
      if (selectedIds.includes(thread.threadId)) {
        await gmail.markAsRead(thread.refreshToken, thread.messageIds);
        markedCount++;
      }
    }

    return { ...state, markedCount, completed: true };
  });
