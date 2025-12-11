import { z } from 'zod';
import type { RawEmail, BillingEmail } from '../types.js';

export const billingCategoryEnum = z.enum([
  'receipt',
  'invoice',
  'subscription_renewal',
  'payment_due',
  'bank_statement',
  'payment_confirmation',
  'refund',
  'other',
]);

export const billingIdentificationSchema = z.object({
  billingEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isBilling: z.boolean().describe('Whether this email is billing/money related'),
      category: billingCategoryEnum.optional().describe('The category of billing email'),
      source: z.string().optional().describe('The merchant, bank, or company name'),
      summary: z.string().optional().describe('One sentence summary'),
      amounts: z.array(
        z.object({
          description: z.string().describe('Description of the charge, payment, or balance'),
          amount: z.string().describe('The amount (e.g., "$19.99", "$-50.00" for refunds)'),
        })
      ).optional().describe('Itemized breakdown of amounts'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty billingEmails array.';
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

  return `You are identifying billing and money-related emails.

For each email, determine if it relates to billing, payments, or finances.

BILLING EMAILS INCLUDE:

RECEIPTS:
- Purchase receipts from online or physical stores
- Order confirmations with payment amounts
- Ride-share receipts (Uber, Lyft)
- Food delivery receipts (DoorDash, UberEats, Grubhub)
- Digital purchase receipts (App Store, Google Play, Steam)
- Donation receipts
- PayPal, Venmo, Zelle transaction confirmations

INVOICES:
- Bills to be paid
- Outstanding invoices
- Payment requests
- Utility bills (electric, gas, water, internet)
- Medical bills
- Legal or professional service invoices

SUBSCRIPTION RENEWALS:
- "Your subscription will renew on..."
- "Your card will be charged..."
- Upcoming automatic payments
- Subscription confirmation emails
- Free trial ending notices

PAYMENT DUE REMINDERS:
- "Payment due on..."
- "Your bill is ready"
- Overdue notices
- Final payment reminders
- Minimum payment due notices

BANK STATEMENTS:
- Monthly/quarterly statements
- Account balance updates
- Transaction summaries
- Credit card statements
- Investment account statements

PAYMENT CONFIRMATIONS:
- "We received your payment"
- Bill payment confirmations
- Transfer confirmations
- Direct deposit notifications

REFUNDS:
- Refund processed
- Credit issued
- Money returned

DO NOT INCLUDE:
- Shipping notifications without payment details
- Marketing emails or promotions (even with prices)
- Password resets or security alerts
- Newsletters
- Privacy policy updates
- Product announcements

CATEGORIES:
- receipt: Confirmation of completed purchase/payment you made
- invoice: Bill or request for payment you need to make
- subscription_renewal: Notice about upcoming or completed subscription charge
- payment_due: Reminder that payment is due soon or overdue
- bank_statement: Account statement or balance summary
- payment_confirmation: Confirmation that a bill payment was received
- refund: Money being returned to you
- other: Other billing-related emails

SUMMARY GUIDELINES:
- Keep summaries to ONE sentence
- Focus on what was paid/owed/due
- Examples:
  - "Monthly subscription renewed for $14.99"
  - "Electric bill due Dec 15 - $127.43"
  - "Uber ride from downtown to airport"
  - "Chase credit card statement - $1,234.56 balance"

AMOUNTS GUIDELINES:
- List each charge, payment, or balance separately
- Include the amount for each item
- Format amounts with dollar sign (e.g., "$19.99")
- For refunds, use negative (e.g., "$-50.00")
- Include totals, minimums due, or balances

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it is billing-related, and if so the category, source, summary, and amounts.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof billingIdentificationSchema>
): BillingEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.billingEmails
    .filter(item => item.isBilling && item.source && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        category: item.category || 'other',
        source: item.source!,
        summary: item.summary!,
        amounts: item.amounts || [],
      };
    })
    .filter((item): item is BillingEmail => item !== null);
}

export function getClaimedIds(processed: BillingEmail[]): string[] {
  return processed.map(p => p.emailId);
}

export const categoryLabels: Record<string, string> = {
  receipt: 'Receipts',
  invoice: 'Invoices',
  subscription_renewal: 'Subscriptions',
  payment_due: 'Payment Due',
  bank_statement: 'Statements',
  payment_confirmation: 'Payments Received',
  refund: 'Refunds',
  other: 'Other',
};
