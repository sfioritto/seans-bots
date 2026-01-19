import { z } from 'zod';
import type { CategorizedEmail } from '../types.js';

export const summarizeSecurityAlertsPrompt = {
  template: (state: { emails: CategorizedEmail[] }) => {
    const threads = state.emails.filter((e) => e.category === 'securityAlerts').map((e) => e.thread);
    if (threads.length === 0) {
      return 'No security alert emails. Return an empty string for summary.';
    }
    const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
    return `Here are security alert emails (sign-in notifications, password changes, new device alerts, etc.).

Summarize them grouped by service. Include:
- The service name (Google, Apple, bank name, etc.)
- Type of alert (sign-in, new device, password change)
- Location or device info if mentioned

Format: "Google: 2 sign-ins (Chicago, NYC); Apple: new device added; Chase: password changed"

Keep it concise - just service, alert type, and key details.

${threadBodies}`;
  },
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('Summary of security alerts grouped by service and type, e.g. "Google: 2 sign-ins (Chicago, NYC); Apple: new device added". Empty string if no emails.'),
    }),
    name: 'securityAlertsSummary' as const,
  },
};
