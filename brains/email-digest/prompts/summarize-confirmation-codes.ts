import { z } from 'zod';
import type { CategorizedEmail } from '../types.js';

export const summarizeConfirmationCodesPrompt = {
  template: (state: { emails: CategorizedEmail[] }) => {
    const threads = state.emails.filter((e) => e.category === 'confirmationCodes').map((e) => e.thread);
    if (threads.length === 0) {
      return 'No confirmation code emails. Return an empty string for summary.';
    }
    const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
    return `Here are confirmation code / verification emails (OTP codes, 2FA codes, verification links, etc.).

Summarize them grouped by service. Include:
- The service name
- The code if visible (numeric codes like 123456)
- Or note "verification link" if it's a link-based verification

Format: "GitHub: 123456; Slack: 789012; Gmail: verification link"

Keep it concise - just service and code/type.

${threadBodies}`;
  },
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('Summary of confirmation codes grouped by service with the code if visible, e.g. "GitHub: 123456; Slack: 789012; Gmail: verification link". Empty string if no emails.'),
    }),
    name: 'confirmationCodesSummary' as const,
  },
};
