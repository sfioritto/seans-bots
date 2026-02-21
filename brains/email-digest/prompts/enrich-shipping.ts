import { z } from 'zod';
import type { RawThread } from '../types.js';

export const enrichShippingPrompt = {
  template: (thread: RawThread) => `Analyze this shipping notification email and extract key details.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. sender - The company name (e.g. "Apple", "Amazon", "FedEx", "UPS")
2. item - What was shipped, if mentioned (e.g. "AirPods Pro", "2 items"). Use "package" if not specified.
3. status - Delivery status or expected date (e.g. "shipped, arriving Jan 18", "delivered", "in transit")`,
  outputSchema: {
    schema: z.object({
      sender: z.string().describe('Company name (e.g. "Apple", "Amazon", "FedEx")'),
      item: z.string().describe('What was shipped (e.g. "AirPods Pro", "package")'),
      status: z.string().describe('Delivery status or expected date (e.g. "shipped, arriving Jan 18", "delivered")'),
    }),
    name: 'shippingEnriched' as const,
  },
};
