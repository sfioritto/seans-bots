import { z } from 'zod';
import type { RawThread } from '../types.js';

export const summarizeRemindersPrompt = {
  template: (threads: RawThread[]) => {
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
      summary: z.string().describe('Summary of upcoming events/reminders grouped by date or type, e.g. "Today: dentist 2pm, team sync 4pm; Tomorrow: flight to NYC"'),
    }),
    name: 'remindersSummary' as const,
  },
};
