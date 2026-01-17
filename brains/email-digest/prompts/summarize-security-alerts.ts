import { z } from 'zod';
import type { RawThread } from '../types.js';

export const summarizeSecurityAlertsPrompt = {
  template: (threads: RawThread[]) => {
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
      summary: z.string().describe('Summary of security alerts grouped by service and type, e.g. "Google: 2 sign-ins (Chicago, NYC); Apple: new device added"'),
    }),
    name: 'securityAlertsSummary' as const,
  },
};
