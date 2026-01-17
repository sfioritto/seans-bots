import { z } from 'zod';
import type { RawThread } from '../types.js';

export const enrichChildrenPrompt = {
  template: (thread: RawThread) => `Analyze this email about children/kids activities.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. A one-sentence summary of what this email is about
2. If there's an action item the parent needs to do (sign up, pay, respond, bring something, etc.), describe it. If no action needed, return null.`,
  outputSchema: {
    schema: z.object({
      summary: z.string().describe('One sentence summary of what this email is about'),
      actionItem: z.string().nullable().describe('If there is something the parent needs to do, describe it briefly. Otherwise null.'),
    }),
    name: 'childrenEnriched' as const,
  },
};
