import { z } from 'zod';

const developerGroupSchema = z.object({
  canonicalName: z.string().describe('The canonical name to use for this developer'),
  emails: z.array(z.string()).describe('All email addresses belonging to this developer'),
  githubUsernames: z.array(z.string()).describe('GitHub usernames for this developer'),
});

export const nameDedupPrompt = {
  template: ({
    uniqueNames,
    emails,
    githubUsernames,
  }: {
    uniqueNames: string[];
    emails: string[];
    githubUsernames: string[];
  }) => {
    return `You are helping identify duplicate developer identities across a codebase.

DEVELOPER NAMES FROM COMMITS:
${uniqueNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

EMAIL ADDRESSES:
${emails.map((e, i) => `${i + 1}. ${e}`).join('\n')}

GITHUB USERNAMES FROM PRs:
${githubUsernames.map((u, i) => `${i + 1}. ${u}`).join('\n')}

TASK:
1. Identify which names, emails, and GitHub usernames belong to the same person
2. Group them together under a canonical name (use their most professional-looking full name)
3. Match GitHub usernames to email addresses where possible (look for similar patterns)

RULES:
- Same email domain + similar first name = likely same person
- GitHub username often matches part of email or name
- "John Smith" and "jsmith@company.com" and "jsmith" are likely the same person
- Be conservative - only group if reasonably confident
- Every email should appear in exactly one group
- If a person only has one identity, still include them as a single-entry group

Return all developer identities grouped by person.`;
  },
  outputSchema: {
    schema: z.object({
      developerGroups: z.array(developerGroupSchema).describe('Groups of developer identities'),
    }),
    name: 'nameDeduplication' as const,
  },
};
