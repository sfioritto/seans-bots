import { z } from 'zod';
import type { RawThread } from '../types.js';

export const enrichBillingPrompt = {
  template: (thread: RawThread) => `Analyze this billing/payment email and extract the amount owed.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. Brief description of what this bill or payment is for (e.g., "Citi credit card statement", "Electric bill", "Netflix subscription")
2. The dollar amount - IMPORTANT: You MUST extract any dollar amount you find. Look for:
   - "Statement Balance" followed by an amount like "$544.02"
   - "Amount Due" or "Total Due" followed by an amount
   - "Balance" followed by an amount
   - Any dollar amount with $ sign
   Return the amount as a string like "$544.02". Only return empty string if there is truly no dollar amount anywhere.`,
  outputSchema: {
    schema: z.object({
      description: z.string().describe('Brief description of what this bill/payment is for'),
      amount: z.string().describe('The dollar amount owed (e.g. "$544.02", "$99.00"). Extract from Statement Balance, Amount Due, Total Due, or any visible dollar amount. If no amount found, return empty string.'),
    }),
    name: 'billingEnriched' as const,
  },
};
