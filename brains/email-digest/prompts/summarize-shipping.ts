import { z } from 'zod';
import type { RawThread } from '../types.js';

export const summarizeShippingPrompt = {
  template: (threads: RawThread[]) => {
    const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
    return `Here are shipping notification emails (order shipped, delivery updates, tracking).

Summarize them grouped by sender/company. Include:
- The sender (Apple, Amazon, FedEx, etc.)
- What was shipped (product name if mentioned)
- Delivery status or expected date if available

Format: "Apple: AirPods shipped, arriving Jan 18; Amazon: package delivered; FedEx: package in transit"

Keep it concise - just sender, item, and status.

${threadBodies}`;
  },
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('Summary of shipping updates grouped by sender, e.g. "Apple: AirPods shipped, arriving Jan 18; Amazon: package delivered"'),
    }),
    name: 'shippingSummary' as const,
  },
};
