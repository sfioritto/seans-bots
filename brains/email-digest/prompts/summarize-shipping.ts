import { z } from 'zod';
import type { RawThread } from '../types.js';

export const summarizeShippingPrompt = {
  template: (thread: RawThread) => `Summarize this shipping notification in one short line.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Format: "Sender: item, status" (e.g. "Apple: AirPods shipped, arriving Jan 18")`,
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('One-line shipping summary, e.g. "Apple: AirPods shipped, arriving Jan 18"'),
    }),
    name: 'shippingSummary' as const,
  },
};
