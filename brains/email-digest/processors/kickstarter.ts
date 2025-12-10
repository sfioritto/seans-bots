import { z } from 'zod';
import type { RawEmail, KickstarterEmail } from '../types.js';

export const kickstarterIdentificationSchema = z.object({
  kickstarterEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isKickstarterRelated: z.boolean().describe('Whether this email is related to a Kickstarter project'),
      summary: z.string().optional().describe('One sentence summary of the email'),
      actionItems: z.array(z.string()).optional().describe('List of actions the user needs to take, if any'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty kickstarterEmails array.';
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

  return `You are identifying emails related to Kickstarter campaigns and crowdfunding projects.

For each email, determine if it is related to a Kickstarter project and extract details.

KICKSTARTER-RELATED INCLUDES:
- Direct emails from kickstarter.com
- Emails from BackerKit, CrowdOx, or other fulfillment platforms for Kickstarter projects
- Shipping notifications for Kickstarter-backed products
- Updates from creators about their Kickstarter projects (even if from their own domains)
- Survey requests for Kickstarter pledges
- Any other email clearly related to a crowdfunded project

DO NOT INCLUDE:
- General promotional emails that just mention crowdfunding
- News articles about Kickstarter
- Unrelated emails

ACTION ITEMS should include things like:
- Completing a backer survey
- Updating a shipping address
- Confirming add-ons or pledge amounts
- Responding to a creator question
- Making a payment or providing payment info
- Any deadline-sensitive actions

If there are no actions required, return an empty actionItems array.

SUMMARY GUIDELINES:
- Keep summaries to ONE clear sentence
- Include the project name if mentioned
- Include relevant dates if time-sensitive
- Examples:
  - "Board game project has shipped and will arrive next week"
  - "BackerKit survey for dice set project needs your shipping address"
  - "Creator posted update about manufacturing delays"

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it is Kickstarter-related, and if so the summary and action items.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof kickstarterIdentificationSchema>
): KickstarterEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.kickstarterEmails
    .filter(item => item.isKickstarterRelated && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        summary: item.summary!,
        actionItems: item.actionItems || [],
      };
    })
    .filter((item): item is KickstarterEmail => item !== null);
}

export function getClaimedIds(processed: KickstarterEmail[]): string[] {
  return processed.map(p => p.emailId);
}
