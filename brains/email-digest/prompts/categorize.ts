import { z } from 'zod';
import type { RawThread } from '../types.js';

export const categorizePrompt = {
  template: (thread: RawThread) => `I am Sean Fioritto. My wife is Beth Fioritto. Her most common email address is beth.lukes@gmail.com. The emails you are reading are from my inbox. My kids are Isaac and Ada. My sister is Mia Fioritto Rubin.

Categorize this email into exactly ONE category. Choose the BEST fit.

From: ${thread.from}
Subject: ${thread.subject}
Body: ${thread.body}

STEP 1 - CHECK IF THIS IS A NEWSLETTER OR MASS EMAIL:
Look at the email body content carefully. Is this a newsletter? Signs of a newsletter:
- Has unsubscribe link or "manage preferences" link
- Sent to many people (not addressed to me personally in the body)
- Formatted like a publication (headers, sections, multiple topics)
- From a mailing list or uses marketing email infrastructure
- Content is general/broadcast, not specific to me personally

If it's a newsletter, it goes in "newsletters" (or "children" if about kids activities) - NOT skip.

STEP 2 - IF NOT A NEWSLETTER, CHECK FOR SKIP:
Only use "skip" for emails that are TRULY personal correspondence, important official notices, or calendar invitations:
- ALWAYS skip emails from reminder@superhuman.com (these are snoozed emails I intentionally want to see)
- ALWAYS skip calendar invitations (subject starts with "Invitation:" or contains .ics attachments, meeting invites from Google Calendar, Outlook, etc.)
- A real person wrote this specifically to me and expects/deserves a reply
- It's a personal conversation (back and forth email thread with a person)
- Important government/official notices (application status, 312 city services, legal)
- Family forwarding something they want me to see personally

Examples to SKIP: ANY email from reminder@superhuman.com, ANY calendar invitation (e.g., "Invitation: Team Meeting @ Mon Jan 20"), Beth emailing about vacation plans, Lia responding to my inquiry about childcare availability, "Application Approved" from city/state government, my sister forwarding a flight itinerary she wants me to review

Examples NOT to skip (these are newsletters even if from an individual's name):
- Derek Sivers' blog posts sent to his mailing list
- Substack newsletters
- Any email with unsubscribe links that goes to many subscribers

Categories (pick ONE):
- skip: Truly personal emails requiring my attention/reply, or important official government notices. This includes personal emails from real people specifically to me about my kids (e.g., a teacher emailing me directly, a parent emailing me personally).
- children: ONLY group or automated emails about my kids Ada and Isaac. Must be one of: (1) emails sent to a GROUP (multiple parents, a class list, etc.) about school/activities/camps, (2) automated system emails (Nanit reports, school portal notifications, activity registration confirmations). Do NOT put personal 1-on-1 emails from a real person here - those go in skip.
- amazon: Amazon orders, shipping, deliveries, returns
- billing: Bills with amounts DUE that need to be paid - invoices, utility bills, service bills, subscription renewal notices with pricing. NOT receipts (things already paid), NOT transaction histories.
- receipts: Payment confirmations for things already paid - purchase receipts, subscription payment confirmations, proof of coverage/purchase documents, order confirmations showing amount paid
- investments: Investment accounts, portfolio updates, dividends, trade confirmations
- kickstarter: Kickstarter, Indiegogo, crowdfunding updates
- newsletters: Newsletter subscriptions, periodic digests, Substack, blog digests (even from individuals)
- marketing: Marketing emails, promotions, sales, ads, follow-up sales emails from businesses
- notifications: System notifications, product updates, policy changes, announcements from services/apps (NOT financial, shipping, or security)
- npm: NPM package publish notifications from npmjs.com, npm registry emails
- security-alerts: Sign-in notifications, login alerts, password change alerts, security warnings, "new device" alerts
- confirmation-codes: OTP codes, verification codes, 2FA codes, login codes
- reminders: Automated event reminders, appointment reminders (NOT calendar invitations - those go in skip)
- financial-notifications: Transaction histories (Venmo monthly summary), Explanation of Benefits (EOBs), investment notifications, bank account notifications, statement availability notices
- shipping: Shipment tracking updates, delivery notifications, "your order has shipped" emails, package tracking

Think step by step: First, is this a newsletter/mass email? If yes, categorize it appropriately. If no, is this truly personal correspondence or an important official notice? If yes, skip. For children-related emails specifically: Is this from a real person writing directly to me (skip) OR is it a group email/automated system email (children)?`,
  outputSchema: {
    schema: z.object({
      category: z.enum([
        'skip', 'children', 'amazon', 'billing', 'receipts', 'investments',
        'kickstarter', 'newsletters', 'marketing', 'notifications', 'npm',
        'security-alerts', 'confirmation-codes', 'reminders',
        'financial-notifications', 'shipping'
      ]),
    }),
    name: 'categorized' as const,
  },
};
