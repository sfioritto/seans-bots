import { z } from 'zod';

interface DeveloperData {
  name: string;
  commits: Array<{
    repo: string;
    message: string;
  }>;
  prs: Array<{
    repo: string;
    number: number;
    title: string;
    body: string;
  }>;
}

interface ChangelogData {
  repo: string;
  content: string;
}

export const developerSummaryPrompt = {
  template: ({
    developers,
    changelogs,
  }: {
    developers: DeveloperData[];
    changelogs: ChangelogData[];
  }) => {
    const developerSections = developers.map((dev, i) => {
      const commitList = dev.commits.slice(0, 20).map(c =>
        `- ${c.repo}: ${c.message.split('\n')[0]}`
      ).join('\n');
      const moreCommits = dev.commits.length > 20
        ? `\n... and ${dev.commits.length - 20} more commits`
        : '';

      const prList = dev.prs.map(pr => {
        const bodyPreview = pr.body ? pr.body.slice(0, 200) : 'No description';
        return `- ${pr.repo} #${pr.number}: ${pr.title}\n  Description: ${bodyPreview}`;
      }).join('\n');

      return `---
DEVELOPER ${i + 1}: ${dev.name}

COMMITS (${dev.commits.length}):
${commitList}${moreCommits}

MERGED PRs (${dev.prs.length}):
${prList || 'None'}`;
    }).join('\n\n');

    const changelogSection = changelogs
      .filter(c => c.content)
      .map(c => `${c.repo}:\n${c.content.slice(0, 500)}`)
      .join('\n\n');

    return `You are generating a weekly developer summary for a software team.

FOR EACH DEVELOPER, I'm providing their commits and PRs from the past week.

${developerSections}

---
CHANGELOG ENTRIES (for additional context on recent releases):
${changelogSection || 'None available'}

TASK:
For each developer, generate 2-5 plain English bullet points summarizing what they accomplished this week.

GUIDELINES:
- Focus on the "what" and "why", not technical details
- Group related commits into single accomplishments
- Use past tense ("Added...", "Fixed...", "Implemented...")
- Prioritize impactful work (features > refactoring > minor fixes)
- Keep each bullet to 1 sentence
- If a developer had minimal activity (1-2 trivial commits), just say what they did without padding
- Skip developers with zero commits and PRs`;
  },
  outputSchema: {
    schema: z.object({
      summaries: z.array(z.object({
        name: z.string().describe('Developer name'),
        accomplishments: z.array(z.string()).describe('Plain English bullet points of what they did'),
      })).describe('Summary for each developer'),
    }),
    name: 'developerSummaries' as const,
  },
};
