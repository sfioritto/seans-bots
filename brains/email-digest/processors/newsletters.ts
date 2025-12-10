import { z } from 'zod';
import type { RawEmail, NewsletterEmail } from '../types.js';

export const newsletterIdentificationSchema = z.object({
  newsletterEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isNewsletter: z.boolean().describe('Whether this email is a newsletter'),
      newsletterName: z.string().optional().describe('The name of the newsletter'),
      summary: z.string().optional().describe('Two sentence summary of what the newsletter contains'),
      deadlines: z.array(z.string()).optional().describe('List of deadlines, opportunities, or time-sensitive items mentioned'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty newsletterEmails array.';
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

  return `You are identifying newsletter emails from a list of inbox emails.

For each email, determine if it is a newsletter and extract details.

NEWSLETTERS INCLUDE:
- Regularly scheduled email publications sent to subscribers
- Digests, roundups, or curated content emails
- Daily/weekly/monthly updates from publications, blogs, or content creators
- Email courses or drip campaigns with educational content
- Industry news roundups or summaries
- Substack, Revue, Buttondown, or similar newsletter platforms
- Marketing emails that are primarily informational/content-focused (not transactional)

DO NOT INCLUDE:
- Transactional emails (receipts, shipping notifications, password resets)
- Personal emails from individuals
- Direct marketing/promotional emails for specific products or sales
- Social media notifications
- Account alerts or security notifications
- Calendar invites or event reminders

SUMMARY GUIDELINES:
- Keep summaries to exactly TWO sentences
- Focus on the main topics or highlights covered in this edition
- Be specific about the content, not generic descriptions
- Examples:
  - "Covers the latest AI developments including GPT-5 rumors and new open-source models. Also discusses the tech layoffs trend and what it means for developers."
  - "This week's edition focuses on productivity tips for remote workers. Features an interview with a time management expert and reviews of calendar apps."

DEADLINES GUIDELINES:
- Include any deadlines, expiring opportunities, limited-time offers, or time-sensitive items
- Include application deadlines, registration cutoffs, early bird pricing, sale end dates
- Include event dates, webinar times, conference registration deadlines
- Be specific with dates when mentioned (e.g., "Early bird pricing ends Dec 15")
- If no deadlines or time-sensitive items, return an empty array

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it is a newsletter, and if so the newsletter name, summary, and deadlines.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof newsletterIdentificationSchema>
): NewsletterEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.newsletterEmails
    .filter(item => item.isNewsletter && item.newsletterName && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        newsletterName: item.newsletterName!,
        summary: item.summary!,
        deadlines: item.deadlines || [],
      };
    })
    .filter((item): item is NewsletterEmail => item !== null);
}

export function getClaimedIds(processed: NewsletterEmail[]): string[] {
  return processed.map(p => p.emailId);
}
