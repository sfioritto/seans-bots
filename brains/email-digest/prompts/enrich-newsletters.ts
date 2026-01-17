import { z } from 'zod';
import type { RawThread } from '../types.js';

export const enrichNewslettersPrompt = {
  template: (thread: RawThread) => `Find links in this newsletter email.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

Find these two types of links:

1. Web view link - URL to view this newsletter in a web browser. Common patterns:
   - "View in browser" / "View in your browser"
   - "Read online" / "View this email online"

2. Unsubscribe link - URL to unsubscribe from this newsletter. Common patterns:
   - "Unsubscribe" / "Opt out"
   - "Manage preferences" / "Email preferences"
   - "Subscription preferences"

Return the full URLs (starting with http:// or https://) if found, or null if not found.`,
  outputSchema: {
    schema: z.object({
      webLink: z.string().nullish().describe('The URL to view this newsletter in a web browser. Look for links like "View in browser", "Read online", "View this email in your browser", "Click here to read online". If no such link exists, return null.'),
      unsubscribeLink: z.string().nullish().describe('The URL to unsubscribe from this newsletter. Look for links containing "unsubscribe", "opt out", "manage preferences", "email preferences", "subscription preferences". If no such link exists, return null.'),
    }),
    name: 'newslettersEnriched' as const,
  },
};
