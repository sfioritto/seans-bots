import { brain } from '../brain.js';
import { z } from 'zod';

const actionItemSchema = z.object({
  actionItems: z.array(
    z.object({
      email: z.string().describe('The subject of the email'),
      items: z.array(z.string()).describe('List of action items from this email'),
    })
  ),
});

const emailActionItemsBrain = brain('email-action-items')
  .step('Fetch emails from all accounts', async ({ state, gmail }) => {
    // Search for emails containing keywords related to your topics
    const query = '(district 97 OR isaac OR "oak park" OR "rock climbing") is:unread';

    const accounts = gmail.getAccounts();

    // Fetch messages from each account
    const allMessages = [];

    for (const account of accounts) {
      const messages = await gmail.searchMessages(account.refreshToken, query, 50);

      for (const message of messages) {
        allMessages.push({
          account: account.name,
          ...message,
        });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      ...state,
      allMessages,
      totalMessages: allMessages.length,
    };
  })
  .step('Fetch message details', async ({ state, gmail }) => {
    if (state.allMessages.length === 0) {
      return {
        ...state,
        messageDetails: [],
      };
    }

    const accounts = gmail.getAccounts();
    const accountTokenMap = new Map(accounts.map((a) => [a.name, a.refreshToken]));

    const messageDetails = [];

    for (const message of state.allMessages) {
      const refreshToken = accountTokenMap.get(message.account);
      if (!refreshToken) continue;

      const details = await gmail.getMessageDetails(refreshToken, message.id);
      messageDetails.push({
        ...details,
        account: message.account,
      });

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return {
      ...state,
      messageDetails,
    };
  })
  .prompt('Extract action items', {
    template: ({ messageDetails }) => {
      const emailSummaries = messageDetails
        .map(
          (email: any, index: number) => `
Email ${index + 1}:
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}

Body:
${email.body.substring(0, 1500)}
---
`
        )
        .join('\n');

      return `You are an AI assistant helping to identify action items from emails.

I have ${messageDetails.length} emails related to District 97 (school), Isaac, Oak Park schools, and rock climbing.

Please read through each email and extract specific action items that require my attention or action.

For each email, list the concrete tasks or actions I need to take. Focus on:
- Tasks I need to complete
- Events I need to attend
- Items I need to respond to
- Deadlines I need to meet
- Things I need to prepare or bring

Here are the emails:

${emailSummaries}

Please extract the action items and organize them by email.`;
    },
    outputSchema: {
      schema: actionItemSchema,
      name: 'actionItems' as const,
    },
  })
  .step('Format final output', ({ state }) => {
    const totalActionItems = state.actionItems.actionItems.reduce(
      (sum: number, email: any) => sum + email.items.length,
      0
    );

    return {
      ...state,
      summary: {
        totalEmails: state.messageDetails.length,
        totalActionItems,
      },
    };
  });

export default emailActionItemsBrain;
