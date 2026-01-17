import { z } from 'zod';
import type { RawThread } from '../types.js';

export const enrichFinancialPrompt = {
  template: (thread: RawThread) => `Analyze this financial notification email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Provide:
1. Brief description of what this financial notification is about (e.g., "Venmo payment received", "EOB for doctor visit", "Dividend payment")
2. The dollar amount if visible (e.g. "$49.99", "$1,234.56"). Look for transaction amounts, payment amounts, dividend amounts, claim amounts, etc. If no amount is visible, return null.`,
  outputSchema: {
    schema: z.object({
      description: z.string().describe('Brief description of what this financial notification is about'),
      amount: z.string().nullable().describe('The dollar amount if visible (e.g. "$49.99", "$1,234.56"). Otherwise null.'),
    }),
    name: 'financialEnriched' as const,
  },
};
