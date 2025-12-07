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
2. A list of specific accomplishments (2-5 bullet points)

TONE FOR SUMMARY: Casual, friendly, like a quick standup update. Examples:
- "Knocked out some low-hanging fruit this week"
- "Merged a couple big changes"
- "Quiet week, just some minor fixes"
- "Heavy lifting on the auth refactor"
- "Crushed a bunch of bugs"
- "Lots of test coverage improvements"
- "Big feature push this week"

ACCOMPLISHMENT BULLETS:
- Group related commits into meaningful accomplishments
- Each bullet should describe WHAT was done (not just repeat commit messages)
- Include size/effort context inline, e.g. "[Large] Refactored auth system" or "[Small fix] Edge case in validation"
- Size tags: [Large], [Medium], [Small], [Small fix]
- Focus on impact, not just activity

ASSESSMENT CRITERIA:
- Look at TOTAL lines changed AND number of files
- Consider file TYPES (core code vs tests vs config)
- Large lines in config/generated files = less impressive than small targeted code changes
- Many files touched = potentially complex coordination
- Commits mentioning "refactor", "fix edge case", "performance" = harder work
- PR descriptions with lots of detail = likely complex changes

SIZE/IMPACT GUIDE:
- [Small fix]: <20 lines, single file, minor tweak
- [Small]: 20-50 lines, routine work
- [Medium]: 50-200 lines, meaningful feature or fix
- [Large]: 200+ lines OR complex multi-file changes

GUIDELINES:
- Be honest - if someone had a light week, say so casually (no judgment)
- If someone did impressive work, acknowledge it
- Skip developers with zero commits`;
  },
  outputSchema: {
    schema: z.object({
      summaries: z.array(z.object({
        name: z.string().describe('Developer name'),
        summary: z.string().describe('One casual sentence about their week'),
        accomplishments: z.array(z.string()).describe('List of specific accomplishments with size tags'),
      })).describe('Summary for each developer'),
    }),
    name: 'developerSummaries' as const,
  },
};
