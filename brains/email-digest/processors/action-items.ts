import { z } from 'zod';
import type { RawEmail, ActionItemsMap, ActionItem } from '../types.js';

// Schema for extracting action items from categorized emails
export const actionItemExtractionSchema = z.object({
  emailActionItems: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      items: z.array(
        z.object({
          description: z.string().describe('The action item description'),
          exactQuote: z.string().describe('The EXACT text from the email that explicitly requests this action'),
          context: z.string().describe('Additional context from the email that is relevant to this action item, or empty string if none'),
          link: z.string().describe('URL to complete the action if available in the email, or empty string if none'),
          steps: z.array(z.string()).describe('Step-by-step directions if no link is available, or empty array if not needed'),
        })
      ).describe('List of action items from this email, empty if none'),
    })
  ),
});

export function buildExtractionPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty emailActionItems array.';
  }

  const emailSummaries = emails
    .map(
      (email, index) => `
Email ${index + 1}:
ID: ${email.id}
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Snippet: ${email.snippet}
Body Preview:
${email.body}
---`
    )
    .join('\n');

  return `You are extracting action items from emails for a parent whose child (Isaac) attends Gwendolyn Brooks Middle School.

CRITICAL DEFINITION - WHAT IS AN ACTION ITEM:
An action item is something where if I DON'T do it:
1. Isaac will MISS AN OPPORTUNITY (can't attend a field trip, miss a registration deadline, etc.)
2. Someone is WAITING for my response (teacher needs payment, permission slip, RSVP, etc.)
3. Isaac will face a NEGATIVE CONSEQUENCE (late fee, can't participate, etc.)

REAL-WORLD EXAMPLES OF ACTION ITEMS:
✅ "Pay for field trip by [date]" - Isaac misses the trip if I don't pay
✅ "Return permission slip" - Teacher is waiting, Isaac can't participate
✅ "Bring lunch on [date]" - Isaac will be hungry if I don't prepare it
✅ "Register by [deadline]" - Isaac misses out on the opportunity
✅ "RSVP by [date]" - Someone is waiting for my response

NOT ACTION ITEMS:
❌ Board meeting highlights - purely informational
❌ "Students are forming a club" - announcement, not a request
❌ Newsletter updates - no action required
❌ Celebration announcements - just sharing news

FILTERING:
- Focus on emails about Isaac, Brooks Middle School, and rock climbing
- Ignore Whittier Elementary (he no longer attends)
- Ignore activities Isaac isn't in (cross country, robotics, Fledglings, etc.)
- Isaac IS in choir, so include choir-related emails

INSTRUCTIONS:
For each email, ask yourself: "Is there something I need to DO here, or will something bad happen / someone is waiting / Isaac misses out?"

If YES, extract the action items with:
1. Description: What specific action do I need to take?
2. Exact quote: The text from the email that indicates this action is needed
3. Context: Why is this needed? What's the deadline? What happens if I don't do it?
4. Link: Any URL to complete the action (or empty string)
5. Steps: How to do it if no link (or empty array)

If NO action items, return an empty items array for that email.

Here are ${emails.length} emails to analyze:

${emailSummaries}

Return action items for each email (empty array if none).`;
}

export function processResults(
  emails: RawEmail[],
  extraction: z.infer<typeof actionItemExtractionSchema>
): ActionItemsMap {
  const actionItemsMap: ActionItemsMap = {};

  for (const emailResult of extraction.emailActionItems) {
    if (emailResult.items.length > 0) {
      actionItemsMap[emailResult.emailId] = emailResult.items.map(item => ({
        description: item.description,
        exactQuote: item.exactQuote,
        context: item.context,
        link: item.link,
        steps: item.steps,
      }));
    }
  }

  return actionItemsMap;
}

export function countActionItems(actionItemsMap: ActionItemsMap): number {
  return Object.values(actionItemsMap).reduce((sum, items) => sum + items.length, 0);
}
