import { z } from 'zod';
import type { RawEmail, AmazonEmail } from '../types.js';

export const amazonCategoryEnum = z.enum([
  'order_confirmation',
  'shipping_notification',
  'delivery_notification',
  'delivery_delay',
  'billing',
  'return_refund',
  'promotional',
  'account_security',
  'other'
]);

export const amazonIdentificationSchema = z.object({
  categorizedEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isAmazon: z.boolean().describe('Whether this email is from Amazon'),
      category: amazonCategoryEnum.optional().describe('The category of the email if it is from Amazon'),
      summary: z.string().optional().describe('One-line summary of what this email is about'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty categorizedEmails array.';
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

  return `You are identifying and categorizing Amazon emails.

For each email, determine:
1. Is it from Amazon (from address contains amazon.com)?
2. If yes, what category and a one-line summary

CATEGORY DEFINITIONS:
- order_confirmation: New order placed, order confirmed
- shipping_notification: Package has shipped, tracking available
- delivery_notification: Package delivered, delivery confirmed
- delivery_delay: Delivery is delayed, rescheduled
- billing: Payment issues, invoice, credit card, charges
- return_refund: Return processed, refund issued
- promotional: Marketing, deals, Prime offers, recommendations
- account_security: Password changes, login alerts, verification
- other: Anything else from Amazon

SUMMARY GUIDELINES:
- Keep summaries to ONE short sentence
- Include the key item/product name if mentioned
- Include relevant dates or amounts if important
- Examples: "AirPods Pro delivered", "Order shipped: Kitchen Scale", "$47.99 charged for Prime"

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it's from Amazon, and if so, the category and summary.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof amazonIdentificationSchema>
): AmazonEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.categorizedEmails
    .filter(item => item.isAmazon && item.category && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        category: item.category!,
        summary: item.summary!,
      };
    })
    .filter((item): item is AmazonEmail => item !== null);
}

export function getClaimedIds(processed: AmazonEmail[]): string[] {
  return processed.map(p => p.emailId);
}

export const categoryLabels: Record<string, string> = {
  order_confirmation: 'Orders Placed',
  shipping_notification: 'Shipped',
  delivery_notification: 'Delivered',
  delivery_delay: 'Delays',
  billing: 'Billing',
  return_refund: 'Returns & Refunds',
  promotional: 'Promotions',
  account_security: 'Account Security',
  other: 'Other',
};
