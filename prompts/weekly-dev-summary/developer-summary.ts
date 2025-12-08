import { z } from 'zod';

interface FileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface CommitData {
  repo: string;
  message: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
    files: FileChange[];
  };
}

interface DeveloperData {
  name: string;
  commits: CommitData[];
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
      // Calculate total stats for this developer
      const totalStats = dev.commits.reduce(
        (acc, c) => ({
          additions: acc.additions + (c.stats?.additions || 0),
          deletions: acc.deletions + (c.stats?.deletions || 0),
          total: acc.total + (c.stats?.total || 0),
          fileCount: acc.fileCount + (c.stats?.files?.length || 0),
        }),
        { additions: 0, deletions: 0, total: 0, fileCount: 0 }
      );

      // Collect all unique files changed
      const allFiles = new Set<string>();
      dev.commits.forEach(c => {
        c.stats?.files?.forEach(f => allFiles.add(f.filename));
      });

      // Categorize files
      const fileCategories = {
        core: [] as string[],
        tests: [] as string[],
        config: [] as string[],
        docs: [] as string[],
        other: [] as string[],
      };

      allFiles.forEach(f => {
        if (f.includes('test') || f.includes('spec') || f.includes('__tests__')) {
          fileCategories.tests.push(f);
        } else if (f.match(/\.(json|yml|yaml|toml|config|rc)$/) || f.includes('config') || f === 'package.json' || f === 'Gemfile') {
          fileCategories.config.push(f);
        } else if (f.match(/\.(md|txt|rst)$/) || f.includes('README') || f.includes('CHANGELOG')) {
          fileCategories.docs.push(f);
        } else if (f.match(/\.(rb|ts|js|py|go|rs|java|tsx|jsx)$/)) {
          fileCategories.core.push(f);
        } else {
          fileCategories.other.push(f);
        }
      });

      const commitList = dev.commits.slice(0, 15).map(c => {
        const statsStr = c.stats ? ` (+${c.stats.additions}/-${c.stats.deletions}, ${c.stats.files?.length || 0} files)` : '';
        const filesStr = c.stats?.files?.slice(0, 3).map(f => f.filename).join(', ') || '';
        return `- ${c.repo}: ${c.message.split('\n')[0]}${statsStr}${filesStr ? `\n  Files: ${filesStr}${(c.stats?.files?.length || 0) > 3 ? '...' : ''}` : ''}`;
      }).join('\n');
      const moreCommits = dev.commits.length > 15
        ? `\n... and ${dev.commits.length - 15} more commits`
        : '';

      const prList = dev.prs.map(pr => {
        const bodyPreview = pr.body ? pr.body.slice(0, 200) : 'No description';
        return `- ${pr.repo} #${pr.number}: ${pr.title}\n  Description: ${bodyPreview}`;
      }).join('\n');

      return `---
DEVELOPER ${i + 1}: ${dev.name}
TOTAL: +${totalStats.additions}/-${totalStats.deletions} lines across ${allFiles.size} unique files

FILE BREAKDOWN:
- Core code files: ${fileCategories.core.length} (${fileCategories.core.slice(0, 5).join(', ')}${fileCategories.core.length > 5 ? '...' : ''})
- Test files: ${fileCategories.tests.length}
- Config files: ${fileCategories.config.length}
- Docs: ${fileCategories.docs.length}

COMMITS (${dev.commits.length}):
${commitList}${moreCommits}

MERGED PRs (${dev.prs.length}):
${prList || 'None'}`;
    }).join('\n\n');

    const changelogSection = changelogs
      .filter(c => c.content)
      .map(c => `${c.repo}:\n${c.content.slice(0, 500)}`)
      .join('\n\n');

    return `You are generating a casual weekly developer summary for a software team.

FOR EACH DEVELOPER, I'm providing their commits, PRs, line changes, and files touched.

${developerSections}

---
CHANGELOG ENTRIES (for context):
${changelogSection || 'None available'}

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

ACCOMPLISHMENT BULLETS - THIS IS THE IMPORTANT PART:
Write ONE complete sentence per accomplishment that explains:
- WHAT was done
- WHY it matters (business impact or developer impact)

Write for a mixed audience - even non-developers should get the general idea.

GOOD EXAMPLES:
- "Added password reset flow so users can recover their accounts without contacting support."
- "Fixed a bug where checkout would fail for international customers, which was blocking sales in Europe."
- "Refactored the notification system to make it easier for other developers to add new notification types."
- "Updated the dashboard to show real-time order status, giving the ops team better visibility."
- "Cleaned up old database queries that were slowing down page loads for customers."

BAD EXAMPLES (don't do these):
- "Fixed bug" (too vague, no context)
- "Updated auth.ts" (just describing files, not impact)
- "Refactored code" (what code? why?)
- "[Large] Implemented OAuth2" (no size tags, explain the why)

GUIDELINES:
- Group related commits into single accomplishments
- Focus on impact: Who benefits? What problem does it solve?
- Use plain language - avoid jargon when possible
- If a change is purely technical, explain how it helps other developers
- Skip developers with zero commits`;
  },
  outputSchema: {
    schema: z.object({
      summaries: z.array(z.object({
        name: z.string().describe('Developer name'),
        summary: z.string().describe('One casual sentence about their week'),
        accomplishments: z.array(z.string()).describe('List of accomplishments - complete sentences explaining what and why'),
      })).describe('Summary for each developer'),
    }),
    name: 'developerSummaries' as const,
  },
};
