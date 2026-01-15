import { brain } from '../brain.js';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { VercelClient } from '@positronic/client-vercel';
import mercuryReceiptsWebhook from '../webhooks/mercury-receipts.js';
import { generateMercuryReceiptsPage } from './mercury-receipts/templates/confirmation-page.js';
import type {
  RawThread,
  MercuryRequest,
  ReceiptCandidate,
  MercuryRequestWithMatches,
} from './mercury-receipts/types.js';

// Use Gemini for larger context windows
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});
const geminiClient = new VercelClient(google('gemini-3-pro-preview'));

// Schema for identifying Mercury request threads and extracting details
const mercuryIdentificationSchema = z.object({
  mercuryRequests: z.array(
    z.object({
      threadId: z.string().describe('The Gmail thread ID'),
      isMercuryRequest: z.boolean().describe('Whether this is a Mercury receipt request'),
      amount: z.string().optional().describe('The dollar amount (e.g., "$200.00")'),
      merchant: z.string().optional().describe('The merchant name (e.g., "Anthropic")'),
    })
  ),
});

// Schema for matching receipts to Mercury requests
const receiptMatchingSchema = z.object({
  matches: z.array(
    z.object({
      mercuryRequestId: z.string().describe('The Mercury request thread ID'),
      candidateMatches: z.array(
        z.object({
          threadId: z.string().describe('The receipt thread ID'),
          merchant: z.string().describe('Merchant name from the receipt'),
          amount: z.string().describe('Amount from the receipt'),
          receiptDate: z.string().describe('Date of the receipt'),
          confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
          matchReason: z.string().describe('Why this receipt matches the request'),
        })
      ),
    })
  ),
});

const mercuryReceiptsBrain = brain({
  title: 'mercury-receipts',
  description: 'Matches Mercury bank receipt requests to emails and forwards them automatically',
})
  // Step 1: Search inbox for Mercury receipt request threads
  .step('Search for Mercury receipt requests', async ({ state, gmail }) => {
    const accounts = gmail.getAccounts();

    if (accounts.length === 0) {
      console.log('No Gmail accounts configured');
      return {
        ...state,
        mercuryThreads: [] as RawThread[],
        allAccounts: [] as any[],
      };
    }

    console.log(`Searching ${accounts.length} accounts for Mercury receipt requests...`);

    const mercuryThreads: RawThread[] = [];
    // Mercury sends emails from hello@mercury.com with "requires additional information" in subject
    // Only look for unread AND in inbox - if read or archived, assume receipt was already provided
    const query = 'from:hello@mercury.com subject:"requires additional information" is:unread label:inbox';

    for (const account of accounts) {
      const threads = await gmail.searchThreads(account.refreshToken, query, 50);
      console.log(`Found ${threads.length} Mercury requests in ${account.name}`);

      for (const thread of threads) {
        const details = await gmail.getThreadDetails(account.refreshToken, thread.threadId);
        mercuryThreads.push({
          threadId: thread.threadId,
          subject: details.subject,
          from: details.from,
          date: details.date,
          body: details.body.substring(0, 2000),
          snippet: details.snippet,
          messageCount: details.messageCount,
          messageIds: details.messageIds,
          accountName: account.name,
          refreshToken: account.refreshToken,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`Found ${mercuryThreads.length} total Mercury receipt requests`);

    return {
      ...state,
      mercuryThreads: mercuryThreads as any[],
      allAccounts: accounts as any[],
    };
  })

  // Step 2: Use AI to extract amount/merchant from Mercury threads
  .prompt('Extract Mercury request details', {
    template: ({ mercuryThreads }) => {
      const threads = mercuryThreads as any[];

      if (threads.length === 0) {
        return 'No Mercury threads to analyze. Return an empty mercuryRequests array.';
      }

      const threadSummaries = threads
        .map(
          (t, i) => `
Thread ${i + 1}:
ID: ${t.threadId}
Subject: ${t.subject}
From: ${t.from}
Date: ${t.date}
Body: ${t.body}
---`
        )
        .join('\n');

      return `Extract receipt request details from Mercury bank emails.

Mercury sends emails when they need a receipt forwarded to receipts@mercury.com.
The subject line is like: "Your transaction at Anthropic requires additional information"
The body contains: "Your purchase of $200.00 at Anthropic: Requires a receipt, Requires a note"

For each thread, extract:
- amount: The dollar amount from the body (e.g., "$200.00")
- merchant: The merchant name from the subject or body (e.g., "Anthropic", "LATENT.SPACE/SWYX")

${threadSummaries}

Return the extracted details for each thread. Set isMercuryRequest to true for valid receipt requests.`;
    },
    outputSchema: {
      schema: mercuryIdentificationSchema,
      name: 'mercuryIdentification' as const,
    },
  })

  // Step 3: Process Mercury identification results
  .step('Process Mercury requests', ({ state }) => {
    const threads = state.mercuryThreads as any[];
    const identification = state.mercuryIdentification;

    const mercuryRequests: MercuryRequest[] = identification.mercuryRequests
      .filter((r) => r.isMercuryRequest && r.amount && r.merchant)
      .map((r) => {
        const rawThread = threads.find((t) => t.threadId === r.threadId);
        if (!rawThread) return null;
        return {
          threadId: r.threadId,
          rawThread,
          amount: r.amount!,
          merchant: r.merchant!,
          requestDate: rawThread.date,
        };
      })
      .filter((r): r is MercuryRequest => r !== null);

    console.log(`Processed ${mercuryRequests.length} valid Mercury requests`);

    return { ...state, mercuryRequests: mercuryRequests as any[] };
  })

  // Step 4: Search ALL threads for potential receipt matches
  .step('Search for receipt candidates', async ({ state, gmail }) => {
    const mercuryRequests = state.mercuryRequests as any[];

    if (mercuryRequests.length === 0) {
      console.log('No Mercury requests to search for');
      return { ...state, receiptCandidates: [] as any[] };
    }

    const accounts = state.allAccounts as any[];
    const receiptCandidates: any[] = [];

    // Get unique merchants and amounts to search for
    const merchants = [...new Set(mercuryRequests.map((r) => r.merchant))];
    const amounts = [...new Set(mercuryRequests.map((r) => r.amount.replace('$', '')))]; // Remove $ for search
    console.log(`Searching for receipts - merchants: ${merchants.join(', ')}, amounts: ${amounts.join(', ')}`);

    // Get Mercury request thread IDs to exclude from results
    const mercuryRequestThreadIds = new Set(mercuryRequests.map((r) => r.threadId));

    for (const account of accounts) {
      // Build a broad OR query: (merchant1 OR merchant2 OR amount1 OR amount2) within last week
      // Search for receipts matching either merchant name OR amount
      const searchTerms = [...merchants, ...amounts].map(term => `"${term}"`).join(' OR ');
      const query = `(${searchTerms}) (receipt OR invoice OR payment OR order OR confirmation) newer_than:7d`;
      console.log(`Search query: ${query}`);

      const threads = await gmail.searchThreads(account.refreshToken, query, 100);
      console.log(`Found ${threads.length} potential matches in ${account.name}`);

      for (const thread of threads) {
        // Skip Mercury request threads themselves
        if (mercuryRequestThreadIds.has(thread.threadId)) continue;

        // Skip if we already have this candidate
        if (receiptCandidates.some((c) => c.threadId === thread.threadId)) continue;

        const details = await gmail.getThreadDetails(account.refreshToken, thread.threadId);
        receiptCandidates.push({
          threadId: thread.threadId,
          subject: details.subject,
          from: details.from,
          date: details.date,
          body: details.body.substring(0, 3000),
          snippet: details.snippet,
          messageCount: details.messageCount,
          messageIds: details.messageIds,
          accountName: account.name,
          refreshToken: account.refreshToken,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`Found ${receiptCandidates.length} potential receipt candidates`);

    return { ...state, receiptCandidates: receiptCandidates as any[] };
  })

  // Step 5: Use AI to match receipts to Mercury requests
  .prompt('Match receipts to requests', {
    template: ({ mercuryRequests, receiptCandidates }) => {
      const requests = mercuryRequests as any[];
      const candidates = receiptCandidates as any[];

      if (requests.length === 0) {
        return 'No Mercury requests to match. Return an empty matches array.';
      }

      if (candidates.length === 0) {
        return `No receipt candidates found. Return matches array with empty candidateMatches for each request:
${requests.map((r) => `- mercuryRequestId: "${r.threadId}"`).join('\n')}`;
      }

      const requestSummaries = requests
        .map(
          (r, i) => `
Request ${i + 1}:
ID: ${r.threadId}
Amount: ${r.amount}
Merchant: ${r.merchant}
Date: ${r.requestDate}
---`
        )
        .join('\n');

      const candidateSummaries = candidates
        .map(
          (c, i) => `
Candidate ${i + 1}:
ID: ${c.threadId}
Subject: ${c.subject}
From: ${c.from}
Date: ${c.date}
Body Preview: ${c.body.substring(0, 1500)}
---`
        )
        .join('\n');

      return `Match receipt emails to Mercury bank receipt requests.

Mercury is asking for receipts for these purchases:
${requestSummaries}

Here are potential receipt emails found:
${candidateSummaries}

For each Mercury request, find matching receipt emails. Consider:
1. **Amount match**: The receipt amount should match or be very close to the request amount
2. **Merchant match**: The receipt should be from the same merchant (fuzzy match OK - "ANTHROPIC" matches "Anthropic", "LATENT.SPACE/SWYX" matches "Latent Space")
3. **Date proximity**: The receipt should be dated on or before the Mercury request (ideally same day or within a few days)

Return matches with confidence scores (0-1) and clear reasoning.
- High confidence (0.8-1.0): Amount matches exactly AND merchant matches AND date is close
- Medium confidence (0.5-0.8): Amount matches but merchant name is slightly different, or date is further away
- Low confidence (0.3-0.5): Possible match but uncertain

If no good match exists for a request, return an empty candidateMatches array for that request.
Include ALL requests in the matches array, even those with no matches.`;
    },
    outputSchema: {
      schema: receiptMatchingSchema,
      name: 'receiptMatching' as const,
    },
    client: geminiClient,
  })

  // Step 6: Build processed data structure
  .step('Build match data', ({ state }) => {
    const requests = state.mercuryRequests as any[];
    const candidates = state.receiptCandidates as any[];
    const matching = state.receiptMatching;

    const requestsWithMatches: MercuryRequestWithMatches[] = requests.map((request) => {
      const matchData = matching.matches.find((m) => m.mercuryRequestId === request.threadId);

      const matches: ReceiptCandidate[] = (matchData?.candidateMatches || [])
        .map((m) => {
          const rawThread = candidates.find((c) => c.threadId === m.threadId);
          if (!rawThread) return null;
          return {
            threadId: m.threadId,
            rawThread,
            merchant: m.merchant,
            amount: m.amount,
            receiptDate: m.receiptDate,
            confidence: m.confidence,
            matchReason: m.matchReason,
          };
        })
        .filter((m): m is ReceiptCandidate => m !== null)
        .sort((a, b) => b.confidence - a.confidence);

      return { request, matches };
    });

    const withMatches = requestsWithMatches.filter((r) => r.matches.length > 0).length;
    const noMatches = requestsWithMatches.length - withMatches;

    console.log(`Built match data: ${requestsWithMatches.length} requests, ${withMatches} with matches, ${noMatches} without`);

    return {
      ...state,
      requestsWithMatches: requestsWithMatches as any[],
    };
  })

  // Step 7: Generate confirmation page
  .step('Generate confirmation page', async ({ state, pages }) => {
    const requestsWithMatches = state.requestsWithMatches as MercuryRequestWithMatches[];

    if (requestsWithMatches.length === 0) {
      console.log('No Mercury requests to process');
      return { ...state, sessionId: '', pageUrl: '' };
    }

    if (!pages) {
      throw new Error('Pages service not available');
    }

    const sessionId = crypto.randomUUID();
    const slug = `mercury-receipts-${sessionId.slice(0, 8)}`;

    const tempHtml = '<html><body>Loading...</body></html>';
    const page = await pages.create(slug, tempHtml, { persist: false });

    const baseUrl = page.url.replace(`/pages/${slug}`, '');
    const webhookUrl = `${baseUrl}/webhooks/mercury-receipts`;

    const html = generateMercuryReceiptsPage(requestsWithMatches, sessionId, webhookUrl);
    await pages.update(slug, html);

    console.log(`Confirmation page created: ${page.url}`);

    return { ...state, sessionId, pageUrl: page.url };
  })

  // Step 8: Send notification
  .step('Send notification', async ({ state, ntfy }) => {
    if (!state.pageUrl) {
      console.log('No page created, skipping notification');
      return state;
    }

    const requestsWithMatches = state.requestsWithMatches as MercuryRequestWithMatches[];
    const withMatches = requestsWithMatches.filter((r) => r.matches.length > 0).length;
    const noMatches = requestsWithMatches.length - withMatches;

    let message = `Mercury receipts: ${requestsWithMatches.length} request${requestsWithMatches.length !== 1 ? 's' : ''}`;
    if (withMatches > 0) message += `, ${withMatches} matched`;
    if (noMatches > 0) message += `, ${noMatches} need attention`;

    await ntfy.send(message, state.pageUrl as string);
    console.log(`Notification sent: ${message}`);

    return state;
  })

  // Step 9: Wait for user confirmation
  .step('Wait for confirmation', ({ state }) => {
    if (!state.sessionId) {
      console.log('No session, completing without waiting');
      return state;
    }

    return {
      state,
      waitFor: [mercuryReceiptsWebhook(state.sessionId as string)],
    };
  })

  // Step 10: Forward selected receipts and archive Mercury threads
  .step('Forward receipts and archive', async ({ state, response, gmail }) => {
    if (!state.sessionId) {
      console.log('No session to process');
      return { ...state, forwarded: false, forwardedCount: 0, archivedCount: 0 };
    }

    const webhookResponse = response as
      | {
          selections: Array<{ mercuryRequestId: string; selectedReceiptId: string | null }>;
          confirmed: boolean;
          mercuryThreadIds: string[];
        }
      | undefined;

    if (!webhookResponse?.confirmed) {
      console.log('Not confirmed');
      return { ...state, forwarded: false, forwardedCount: 0, archivedCount: 0 };
    }

    const requestsWithMatches = state.requestsWithMatches as MercuryRequestWithMatches[];
    let forwardedCount = 0;

    // Forward each selected receipt
    for (const selection of webhookResponse.selections) {
      if (!selection.selectedReceiptId) {
        console.log(`Skipped request ${selection.mercuryRequestId}`);
        continue;
      }

      const request = requestsWithMatches.find((r) => r.request.threadId === selection.mercuryRequestId);
      if (!request) continue;

      const match = request.matches.find((m) => m.threadId === selection.selectedReceiptId);
      if (!match) continue;

      // Forward the latest message in the receipt thread to Mercury
      // Use the first messageId (which is typically the latest message)
      const messageIdToForward = match.rawThread.messageIds[0];
      if (!messageIdToForward) continue;

      const note = `Receipt for ${request.request.merchant} - ${request.request.amount}`;
      await gmail.forwardMessage(match.rawThread.refreshToken, messageIdToForward, 'receipts@mercury.com', note);

      forwardedCount++;
      console.log(`Forwarded receipt for ${request.request.merchant} (${request.request.amount})`);

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Archive all messages in the Mercury request threads
    const mercuryThreads = state.mercuryThreads as RawThread[];
    const messagesByAccount: Record<string, { refreshToken: string; messageIds: string[] }> = {};

    for (const threadId of webhookResponse.mercuryThreadIds) {
      const thread = mercuryThreads.find((t) => t.threadId === threadId);
      if (!thread) continue;

      if (!messagesByAccount[thread.accountName]) {
        messagesByAccount[thread.accountName] = {
          refreshToken: thread.refreshToken,
          messageIds: [],
        };
      }
      // Add all message IDs from this thread
      messagesByAccount[thread.accountName].messageIds.push(...thread.messageIds);
    }

    let archivedCount = 0;
    for (const [accountName, { refreshToken, messageIds }] of Object.entries(messagesByAccount)) {
      // Mark as read first, then archive
      await gmail.markAsRead(refreshToken, messageIds);
      await gmail.archiveMessages(refreshToken, messageIds);
      archivedCount += messageIds.length;
      console.log(`Marked read and archived ${messageIds.length} Mercury request messages from ${accountName}`);
    }

    console.log(`Successfully forwarded ${forwardedCount} receipts, archived ${archivedCount} Mercury messages`);

    return {
      ...state,
      forwarded: true,
      forwardedCount,
      archivedCount,
    };
  });

export default mercuryReceiptsBrain;
