import { z } from 'zod';
import type { RawThread } from '../types.js';

export const summarizeFinancialPrompt = {
  template: (threads: RawThread[]) => {
    const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
    return `Here are financial notification emails (transaction histories, EOBs, account statements, etc.).

Summarize them grouped by service/company. Include:
- The service name (Venmo, UHC, bank name, etc.)
- Type of notification (transaction history, EOB, statement available)
- Time period if mentioned

Format: "Venmo: December transaction history; UHC: EOB available; Chase: statement ready"

Keep it concise - just service, notification type, and key details.

${threadBodies}`;
  },
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('Summary of financial notifications grouped by service, e.g. "Venmo: December transaction history; UHC: EOB available; Schwab: QQQ dividend"'),
    }),
    name: 'financialNotificationsSummary' as const,
  },
};
