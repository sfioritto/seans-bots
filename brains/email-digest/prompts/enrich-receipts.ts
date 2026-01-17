import { z } from 'zod';
import type { RawThread } from '../types.js';

export const enrichReceiptsPrompt = {
  template: (thread: RawThread) => `Analyze this receipt/payment confirmation email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. Brief description of what was purchased or paid for (merchant name or service)
2. The total dollar amount paid if visible (e.g. "$49.99", "$125.00"). If no amount is visible, return null.
3. Individual line items if the receipt lists them (item name and amount for each). If no itemized list is visible, return an empty array.`,
  outputSchema: {
    schema: z.object({
      description: z.string().describe('Brief description of what was purchased/paid (merchant name or service)'),
      totalAmount: z.string().nullable().describe('The total dollar amount paid (e.g. "$49.99"). Otherwise null.'),
      lineItems: z.array(z.object({
        item: z.string().describe('Name or description of the item purchased'),
        amount: z.string().nullable().describe('The dollar amount for this item (e.g. "$49.99"). Otherwise null.'),
      })).describe('Individual items purchased. If no itemized list is visible, return an empty array.'),
    }),
    name: 'receiptsEnriched' as const,
  },
};
