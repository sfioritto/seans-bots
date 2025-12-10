import { z } from 'zod';
import type { RawEmail, IsaacEmail } from '../types.js';

export const isaacIdentificationSchema = z.object({
  isaacEmails: z.array(
    z.object({
      emailId: z.string().describe('The Gmail message ID'),
      isIsaacRelated: z.boolean().describe('Whether this email is related to Isaac'),
      category: z.string().optional().describe('Category: school, rock_climbing, summer_camp, choir, extracurricular, health, or other'),
      summary: z.string().optional().describe('Two sentence summary of the email'),
      actionItems: z.array(
        z.object({
          description: z.string().describe('What action needs to be taken'),
          exactQuote: z.string().describe('The EXACT text from the email that explicitly requests this action'),
          context: z.string().describe('Why this is needed, deadline, consequence if not done'),
          link: z.string().describe('URL to complete the action, or empty string'),
          steps: z.array(z.string()).describe('Step-by-step directions if no link, or empty array'),
        })
      ).optional().describe('Action items from this email'),
    })
  ),
});

export function buildIdentificationPrompt(emails: RawEmail[]): string {
  if (emails.length === 0) {
    return 'No emails to analyze. Return an empty isaacEmails array.';
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

  return `You are identifying emails related to Isaac (a middle school student) and extracting action items.

CONTEXT ABOUT ISAAC:
- Isaac attends Gwendolyn Brooks Middle School (in Oak Park, IL, District 97)
- He is in choir
- He does rock climbing
- He may attend summer camps or other youth activities
- He previously attended Whittier Elementary (ignore these - he no longer attends)

WHAT TO LOOK FOR:
- School communications from Brooks Middle School, District 97, or Oak Park schools
- Rock climbing gym notifications, class schedules, or events
- Summer camp registration, updates, or information
- Choir practice, performances, or events
- Youth sports, extracurricular activities
- Health/medical appointments or school health forms
- Parent-teacher communications
- School events, field trips, permission slips
- Any email that requires action by a parent for their child

DO NOT INCLUDE:
- Whittier Elementary emails (Isaac no longer attends)
- Activities Isaac isn't in (cross country, robotics, Fledglings, etc.)
- Generic newsletters not specifically about Isaac or his activities
- Adult-only activities or events

CATEGORIES:
- school: General school communications, newsletters, announcements
- rock_climbing: Climbing gym, classes, competitions
- summer_camp: Camp registrations, updates, schedules
- choir: Choir practice, performances, events
- extracurricular: Other youth activities
- health: Medical, dental, health forms
- other: Other Isaac-related items

ACTION ITEMS - CRITICAL DEFINITION:
An action item is something where if the parent DON'T do it:
1. Isaac will MISS AN OPPORTUNITY (can't attend field trip, miss registration deadline)
2. Someone is WAITING for a response (teacher needs payment, permission slip, RSVP)
3. Isaac will face a NEGATIVE CONSEQUENCE (late fee, can't participate)

REAL ACTION ITEM EXAMPLES:
✅ "Pay for field trip by [date]" - Isaac misses trip if not paid
✅ "Return permission slip" - Teacher waiting, Isaac can't participate
✅ "Register by [deadline]" - Isaac misses the opportunity
✅ "RSVP by [date]" - Someone is waiting for response
✅ "Schedule appointment" - Health requirement

NOT ACTION ITEMS:
❌ "Students are forming a club" - just an announcement
❌ Board meeting highlights - purely informational
❌ Celebration announcements - just sharing news

SUMMARY GUIDELINES:
- Keep summaries to exactly TWO sentences
- Focus on what the email is about and any key dates/deadlines
- Be specific, not generic

Here are ${emails.length} emails to analyze:

${emailSummaries}

For each email, return its ID, whether it is Isaac-related, and if so the category, summary, and any action items.`;
}

export function processResults(
  emails: RawEmail[],
  identification: z.infer<typeof isaacIdentificationSchema>
): IsaacEmail[] {
  const emailMap = new Map(emails.map(e => [e.id, e]));

  return identification.isaacEmails
    .filter(item => item.isIsaacRelated && item.summary)
    .map(item => {
      const rawEmail = emailMap.get(item.emailId);
      if (!rawEmail) return null;

      return {
        emailId: item.emailId,
        rawEmail,
        category: (item.category || 'other') as IsaacEmail['category'],
        summary: item.summary!,
        actionItems: (item.actionItems || []).map(ai => ({
          description: ai.description,
          exactQuote: ai.exactQuote,
          context: ai.context,
          link: ai.link,
          steps: ai.steps,
        })),
      };
    })
    .filter((item): item is IsaacEmail => item !== null);
}

export function getClaimedIds(processed: IsaacEmail[]): string[] {
  return processed.map(p => p.emailId);
}

export const categoryLabels: Record<string, string> = {
  school: 'School',
  rock_climbing: 'Rock Climbing',
  summer_camp: 'Summer Camp',
  choir: 'Choir',
  extracurricular: 'Extracurricular',
  health: 'Health',
  other: 'Other',
};
