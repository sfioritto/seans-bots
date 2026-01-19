import { z } from 'zod';
import type { CategorizedEmail } from '../types.js';

export const summarizeRemindersPrompt = {
  template: (state: { emails: CategorizedEmail[] }) => {
    const threads = state.emails.filter((e) => e.category === 'reminders').map((e) => e.thread);
    if (threads.length === 0) {
      return 'No reminder emails. Return an empty string for summary.';
    }
    const threadBodies = threads.map(t => `Subject: ${t.subject}\nBody: ${t.body}`).join('\n\n---\n\n');
    return `Here are calendar reminders, event notifications, and appointment reminders.

Summarize them grouped by date/time if available. Include:
- The date/time (Today, Tomorrow, specific date)
- What the event/reminder is about
- Location if mentioned

Format: "Today: dentist 2pm, team sync 4pm; Tomorrow: flight to NYC 8am; Jan 20: doctor appointment"

Keep it concise - just date, event, and time.

${threadBodies}`;
  },
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('Summary of upcoming events/reminders grouped by date or type, e.g. "Today: dentist 2pm, team sync 4pm; Tomorrow: flight to NYC". Empty string if no emails.'),
    }),
    name: 'remindersSummary' as const,
  },
};
