import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { VercelClient } from '@positronic/client-vercel';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const geminiClient = new VercelClient(google('gemini-2.5-pro'));

interface PRData {
  repo: string;
  number: number;
  title: string;
  body: string;
}

interface DeveloperData {
  name: string;
  prs: PRData[];
  meta: {
    totalPRs: number;
    prsReviewed: number;
    prComments: number;
  };
}

export const developerSummaryPrompt = {
  template: ({
    developers,
  }: {
    developers: DeveloperData[];
  }) => {
    const developerSections = developers.map((dev, i) => {
      const prList = dev.prs.map(pr => {
        const body = pr.body || 'No description';
        return `- ${pr.repo} #${pr.number}: ${pr.title}\n  Description: ${body}`;
      }).join('\n');

      return `---
DEVELOPER ${i + 1}: ${dev.name}
PRs MERGED: ${dev.meta.totalPRs}
PRs REVIEWED: ${dev.meta.prsReviewed}
PR COMMENTS: ${dev.meta.prComments}

MERGED PRs:
${prList || 'None'}`;
    }).join('\n\n');

    return `You are generating a casual weekly developer summary for a software team.

FOR EACH DEVELOPER, I'm providing their merged PRs and review activity.

${developerSections}

TASK:
For each developer, provide:
1. ONE casual sentence that captures the vibe of their week
2. A list of accomplishments (2-5 bullet points)

TONE FOR SUMMARY: Casual, friendly, like a quick standup update. Examples:
- "Focused on the auth system this week"
- "Shipped a couple improvements"
- "Quiet week, just some minor fixes"
- "Working through the dashboard refactor"
- "Bug fixing mode"
- "Big feature push"
- "Mostly in review mode this week"

ACCOMPLISHMENT BULLETS - THIS IS THE IMPORTANT PART:
Write ONE complete sentence per accomplishment that explains:
- WHAT was done
- WHY it matters (business impact or developer impact)
- Which PRs are related (by repo and number)

Write for a mixed audience - even non-developers should get the general idea.

GOOD EXAMPLES:
- "Added password reset flow so users can recover their accounts without contacting support."
- "Fixed a bug where checkout would fail for international customers, which was blocking sales in Europe."
- "Refactored the notification system to make it easier for other developers to add new notification types."
- "Updated the dashboard to show real-time order status, giving the ops team better visibility."
- "Reviewed several PRs to help unblock teammates and maintain code quality."

BAD EXAMPLES (don't do these):
- "Fixed bug" (too vague, no context)
- "Updated auth.ts" (just describing files, not impact)
- "Refactored code" (what code? why?)
- "[Large] Implemented OAuth2" (no size tags, explain the why)

GUIDELINES:
- Link each accomplishment to the relevant PR(s) if any exist
- Focus on impact: Who benefits? What problem does it solve?
- Use plain language - avoid jargon when possible
- If a change is purely technical, explain how it helps other developers
- Include review activity as an accomplishment if significant (e.g., "Reviewed X PRs...")
- Skip developers with zero PRs AND zero reviews`;
  },
  outputSchema: {
    schema: z.object({
      summaries: z.array(z.object({
        name: z.string().describe('Developer name'),
        summary: z.string().describe('One casual sentence about their week'),
        accomplishments: z.array(z.object({
          text: z.string().describe('Complete sentence explaining what was done and why'),
          relatedPRs: z.array(z.object({
            repo: z.string().describe('Repository name'),
            number: z.number().describe('PR number'),
          })).describe('PRs related to this accomplishment'),
        })).describe('List of accomplishments with linked PRs'),
      })).describe('Summary for each developer'),
    }),
    name: 'developerSummaries' as const,
  },
  client: geminiClient,
};
