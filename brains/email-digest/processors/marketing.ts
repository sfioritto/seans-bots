import { z } from 'zod';
import type { RawEmail, MarketingEmail } from '../types.js';

export const marketingIdentificationSchema = z.object({
  marketingEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isMarketing: z.boolean().describe('Whether this email is pure marketing/promotional'),
      brand: z.string().optional().describe('The brand or company sending the marketing'),
      summary: z.string().optional().describe('One-line summary of what they are promoting'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty marketingEmails array.';
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

  return `You are identifying pure marketing/promotional emails.

WHAT IS A MARKETING EMAIL:
- Sales, discounts, deals, promotions
- "X% off", "Sale ends soon", "Limited time offer"
- New product announcements just to drive sales
- Abandoned cart reminders
- "We miss you" re-engagement emails
- Loyalty program promotions
- Flash sales, Black Friday, seasonal promotions
- "Check out what's new" product showcases

WHAT IS NOT A MARKETING EMAIL:
- Receipts or order confirmations (even if they have upsells)
- Shipping/delivery notifications
- Account-related emails (password reset, verification)
- Newsletters with actual content (these are different)
- Service updates or policy changes
- Transaction confirmations
- Subscription renewals or billing notices

The key distinction: marketing emails exist ONLY to sell you something. They have no transactional or informational purpose.

SUMMARY GUIDELINES:
- Keep summaries to ONE short sentence
- Focus on what they're promoting
- Examples: "40% off winter sale", "New arrivals in stock", "Flash sale ends tonight"

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it's pure marketing, and if so, the brand and summary.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof marketingIdentificationSchema>
): MarketingEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.marketingEmails
    .filter(item => item.isMarketing && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        brand: item.brand || 'Unknown',
        summary: item.summary!,
      };
    })
    .filter((item): item is MarketingEmail => item !== null);
}

export function getClaimedIds(processed: MarketingEmail[]): string[] {
  return processed.map(p => p.emailId);
}
