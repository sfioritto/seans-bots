import { z } from 'zod';
import type { RawEmail, ReceiptEmail } from '../types.js';

export const receiptIdentificationSchema = z.object({
  receiptEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isReceipt: z.boolean().describe('Whether this email is a receipt or payment notification'),
      merchant: z.string().optional().describe('The merchant or company name'),
      summary: z.string().optional().describe('One sentence summary of the purchase'),
      charges: z.array(
        z.object({
          description: z.string().describe('Description of the charge or item'),
          amount: z.string().describe('The amount charged (e.g., "$19.99")'),
        })
      ).optional().describe('Itemized breakdown of charges'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty receiptEmails array.';
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

  return `You are identifying receipt and payment notification emails.

For each email, determine if it is a receipt or payment notification and extract details.

RECEIPTS INCLUDE:
- Purchase receipts from online or physical stores
- Order confirmations with payment amounts
- Subscription payment notifications
- Bill payment confirmations
- Credit card transaction alerts
- PayPal, Venmo, or other payment service notifications
- Ride-share receipts (Uber, Lyft)
- Food delivery receipts (DoorDash, UberEats, Grubhub)
- Digital purchase receipts (App Store, Google Play, Steam)
- Invoice payments
- Donation receipts

DO NOT INCLUDE:
- Shipping notifications without payment details
- Marketing emails or promotions
- Account statements (unless they show a specific transaction)
- Password resets or security alerts
- Newsletters
- Personal emails

SUMMARY GUIDELINES:
- Keep summaries to exactly ONE sentence
- Focus on what was purchased, not payment details
- Examples:
  - "Ordered kitchen supplies and cleaning products"
  - "Ride from downtown to the airport"
  - "Monthly subscription renewal"

CHARGES GUIDELINES:
- List each line item or charge separately
- Include the amount for each item
- If there's a total, include it as the last item
- Include taxes, fees, tips if shown separately
- Format amounts with dollar sign (e.g., "$19.99")

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it is a receipt, and if so the merchant, summary, and charges.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof receiptIdentificationSchema>
): ReceiptEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.receiptEmails
    .filter(item => item.isReceipt && item.merchant && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        merchant: item.merchant!,
        summary: item.summary!,
        charges: item.charges || [],
      };
    })
    .filter((item): item is ReceiptEmail => item !== null);
}

export function getClaimedIds(processed: ReceiptEmail[]): string[] {
  return processed.map(p => p.emailId);
}
