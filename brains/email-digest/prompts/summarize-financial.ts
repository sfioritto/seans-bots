import { z } from 'zod';
import type { CategorizedEmail } from '../types.js';

export const summarizeFinancialPrompt = {
  template: (state: { emails: CategorizedEmail[] }) => {
    const threads = state.emails.filter((e) => e.category === 'financialNotifications').map((e) => e.thread);
    if (threads.length === 0) {
      return 'No financial notification emails. Return an empty string for summary.';
    }
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
      summary: z.string().describe('Summary of financial notifications grouped by service, e.g. "Venmo: December transaction history; UHC: EOB available; Schwab: QQQ dividend". Empty string if no emails.'),
    }),
    name: 'financialSummary' as const,
  },
};
