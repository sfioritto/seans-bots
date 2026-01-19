import { z } from 'zod';
import type { CategorizedEmail } from '../types.js';

export const summarizeShippingPrompt = {
  template: (state: { emails: CategorizedEmail[] }) => {
    const threads = state.emails.filter((e) => e.category === 'shipping').map((e) => e.thread);
    if (threads.length === 0) {
      return 'No shipping notification emails. Return an empty string for summary.';
    }
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
      summary: z.string().describe('Summary of shipping updates grouped by sender, e.g. "Apple: AirPods shipped, arriving Jan 18; Amazon: package delivered". Empty string if no emails.'),
    }),
    name: 'shippingSummary' as const,
  },
};
