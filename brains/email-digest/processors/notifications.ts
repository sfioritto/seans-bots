import { z } from 'zod';
import type { RawEmail, NotificationEmail } from '../types.js';

export const notificationIdentificationSchema = z.object({
  notificationEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isNotification: z.boolean().describe('Whether this email is a low-value notification'),
      source: z.string().optional().describe('The product, service, or company sending the notification'),
      summary: z.string().optional().describe('One-line summary of the notification'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty notificationEmails array.';
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

  return `You are identifying LOW-VALUE NOTIFICATIONS from products and services.

These are informational emails that don't require action and aren't particularly useful to keep around. They're not spam or marketing - they're legitimate notifications from services I use, but they're just noise.

INCLUDE THESE (low-value notifications):

PRODUCT UPDATES & ANNOUNCEMENTS:
- "We've added a new feature..."
- "Introducing our new dashboard"
- "Gmail emoji reactions are now enabled"
- "Rate limit API requests without extra code"
- Feature announcements I didn't ask for
- "What's new in [Product]"
- Release notes and changelog notifications

POLICY & LEGAL UPDATES:
- "We're updating our privacy policy"
- "Changes to our Terms of Service"
- "We're updating our fees"
- GDPR/CCPA compliance notifications
- "Important changes to how we handle your data"

GENERIC CONFIRMATIONS (that don't matter):
- "You're on the list"
- "Welcome to [service]" (after initial signup)
- "Your preferences have been saved"
- "Your settings have been updated"
- Generic "thanks for being a customer" emails

SYSTEM NOTIFICATIONS:
- "Your export is ready" (for things I don't need anymore)
- Routine maintenance announcements
- "Service will be down for maintenance"
- Status updates about resolved issues

DO NOT INCLUDE (these are actually useful or belong elsewhere):

ACTUALLY USEFUL NOTIFICATIONS:
- "Your new card is on the way" - this is useful, I want to know this
- "Your package has shipped" - useful tracking info
- "Your appointment is tomorrow" - actionable reminder
- "Someone logged into your account" - security alert I need
- "Your password was changed" - security alert I need

BILLING/MONEY (goes in billing category):
- Receipts, invoices, payment confirmations
- "Your subscription will renew"
- Bank statements

MARKETING/SALES (goes in marketing category):
- "50% off sale!"
- Promotional offers
- "Check out our new products"
- Emails trying to sell me something

NEWSLETTERS (goes in newsletters category):
- Regular content newsletters
- Curated content digests

The key test: If I delete this email without reading it carefully, will I miss anything important? If the answer is "no, it's just informational noise" then it's a notification.

SUMMARY GUIDELINES:
- Keep summaries to ONE short sentence
- Just state what the notification is about
- Examples:
  - "New feature: emoji reactions in Gmail"
  - "Privacy policy update effective Jan 1"
  - "API rate limiting feature announced"
  - "Fee structure changes"

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it's a low-value notification, and if so, the source and summary.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof notificationIdentificationSchema>
): NotificationEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.notificationEmails
    .filter(item => item.isNotification && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        source: item.source || 'Unknown',
        summary: item.summary!,
      };
    })
    .filter((item): item is NotificationEmail => item !== null);
}

export function getClaimedIds(processed: NotificationEmail[]): string[] {
  return processed.map(p => p.emailId);
}
