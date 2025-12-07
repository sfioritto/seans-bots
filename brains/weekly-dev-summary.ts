import { brain } from '../brain.js';
import { nameDedupPrompt } from '../prompts/weekly-dev-summary/name-deduplication.js';
import { developerSummaryPrompt } from '../prompts/weekly-dev-summary/developer-summary.js';

const weeklyDevSummaryBrain = brain('weekly-dev-summary')
  .step('Initialize date range', ({ state }) => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    return {
      ...state,
      weekStart: weekStart.toISOString(),
      weekEnd: now.toISOString(),
    };
  })

  .step('Fetch commits from all repos', async ({ state, github }) => {
    const repos = github.getRepoList();
    const allCommits: any[] = [];

    for (const { owner, repo } of repos) {
      const commits = await github.getCommits(owner, repo, state.weekStart, state.weekEnd);
      allCommits.push(...commits);
      // Rate limit protection
      await new Promise(r => setTimeout(r, 100));
    }

    // Filter out merge commits
    const filteredCommits = allCommits.filter(commit => {
      const message = commit.message.toLowerCase();
      return !message.startsWith('merge pull request') &&
             !message.startsWith('merge branch') &&
             !message.match(/^merge [a-f0-9]+ into/);
    });

    console.log(`Fetched ${allCommits.length} commits, ${filteredCommits.length} after filtering merges`);

    return {
      ...state,
      rawCommits: filteredCommits,
    };
  })

  .step('Fetch commit stats', async ({ state, github }) => {
    const commitsWithStats: any[] = [];
    const repos = github.getRepoList();
    const repoOwnerMap = new Map(repos.map(r => [r.repo, r.owner]));

    console.log(`Fetching stats for ${state.rawCommits.length} commits...`);

    for (const commit of state.rawCommits) {
      const owner = repoOwnerMap.get(commit.repo) || 'SOFware';
      const stats = await github.getCommitStats(owner, commit.repo, commit.sha);

      commitsWithStats.push({
        ...commit,
        stats: stats || { additions: 0, deletions: 0, total: 0, files: [] },
      });

      // Rate limit protection
      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`Fetched stats for ${commitsWithStats.length} commits`);

    return {
      ...state,
      rawCommits: commitsWithStats,
    };
  })

  .step('Fetch merged PRs from all repos', async ({ state, github }) => {
    const repos = github.getRepoList();
    const allPRs: any[] = [];

    for (const { owner, repo } of repos) {
      const prs = await github.getMergedPRs(owner, repo, new Date(state.weekStart));
      allPRs.push(...prs);
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`Fetched ${allPRs.length} merged PRs`);

    return {
      ...state,
      rawPRs: allPRs,
    };
  })

  .step('Fetch CHANGELOG files', async ({ state, github }) => {
    const repos = github.getRepoList();
    const changelogs: { repo: string; content: string }[] = [];

    for (const { owner, repo } of repos) {
      const content = await github.getChangelog(owner, repo);
      if (content) {
        changelogs.push({ repo, content });
      }
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`Fetched ${changelogs.length} CHANGELOG files`);

    return {
      ...state,
      changelogs,
    };
  })

  .step('Aggregate data by author', ({ state }) => {
    const developerMap = new Map<string, {
      email: string;
      names: Set<string>;
      commits: any[];
      prs: any[];
    }>();

    // Process commits - group by email
    for (const commit of state.rawCommits) {
      const key = commit.author.email.toLowerCase();
      if (!developerMap.has(key)) {
        developerMap.set(key, {
          email: commit.author.email,
          names: new Set(),
          commits: [],
          prs: [],
        });
      }
      const dev = developerMap.get(key)!;
      dev.names.add(commit.author.name);
      dev.commits.push(commit);
    }

    // Collect unique identifiers for deduplication
    const allNames: string[] = [];
    const allEmails: string[] = [];
    developerMap.forEach((data, email) => {
      allNames.push(...Array.from(data.names));
      allEmails.push(email);
    });

    const githubUsernames = [...new Set(state.rawPRs.map((pr: any) => pr.author))];

    // Convert to array format for the next step
    const developerData = Array.from(developerMap.entries()).map(([email, data]) => ({
      email,
      names: Array.from(data.names),
      commits: data.commits,
      prs: [] as any[], // Will be populated after name deduplication
    }));

    return {
      ...state,
      developerData,
      uniqueNames: [...new Set(allNames)],
      emails: allEmails,
      githubUsernames,
    };
  })

  .prompt('Deduplicate developer identities', nameDedupPrompt)

  .step('Merge duplicate developer identities', ({ state }) => {
    const { nameDeduplication, developerData, rawPRs } = state;

    // Build email-to-canonical-name mapping
    const emailToCanonical = new Map<string, string>();
    const canonicalToEmails = new Map<string, string[]>();
    const canonicalToUsernames = new Map<string, string[]>();

    for (const group of nameDeduplication.developerGroups) {
      const canonical = group.canonicalName;
      canonicalToEmails.set(canonical, group.emails.map((e: string) => e.toLowerCase()));
      canonicalToUsernames.set(canonical, group.githubUsernames || []);

      for (const email of group.emails) {
        emailToCanonical.set(email.toLowerCase(), canonical);
      }
    }

    // Merge developer data under canonical names
    const mergedDevelopers = new Map<string, {
      name: string;
      emails: string[];
      commits: any[];
      prs: any[];
    }>();

    for (const dev of developerData) {
      const canonical = emailToCanonical.get(dev.email.toLowerCase()) || dev.names[0];

      if (!mergedDevelopers.has(canonical)) {
        mergedDevelopers.set(canonical, {
          name: canonical,
          emails: [],
          commits: [],
          prs: [],
        });
      }

      const merged = mergedDevelopers.get(canonical)!;
      merged.emails.push(dev.email);
      merged.commits.push(...dev.commits);
    }

    // Assign PRs based on GitHub username matching
    for (const pr of rawPRs) {
      const prAuthor = pr.author.toLowerCase();

      // Find which canonical name this username belongs to
      for (const [canonical, usernames] of canonicalToUsernames) {
        if (usernames.some((u: string) => u.toLowerCase() === prAuthor)) {
          const merged = mergedDevelopers.get(canonical);
          if (merged) {
            merged.prs.push(pr);
          }
          break;
        }
      }
    }

    const developers = Array.from(mergedDevelopers.values());

    console.log(`Merged into ${developers.length} unique developers`);

    return {
      ...state,
      developers,
    };
  })

  .prompt('Generate developer summaries', developerSummaryPrompt)

  .step('Format Slack message', ({ state }) => {
    const { developerSummaries, weekStart } = state;

    const formatDate = (isoString: string) => {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    };

    // Thread starter message
    const threadStarter = `Developer Summary for week of ${formatDate(weekStart)} 🧵`;

    // Full details for thread reply
    const sections = developerSummaries.summaries
      .filter((dev: any) => dev.summary)
      .map((dev: any) => {
        const bullets = dev.accomplishments && dev.accomplishments.length > 0
          ? dev.accomplishments.map((a: string) => `  • ${a}`).join('\n')
          : '';
        return `*${dev.name}*: ${dev.summary}${bullets ? '\n' + bullets : ''}`;
      })
      .join('\n\n');

    const threadReply = sections || '_No developer activity this week._';

    return {
      ...state,
      threadStarter,
      threadReply,
    };
  })

  .step('Post to Slack', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const channelId = 'UDFFLKPM5'; // DM to Sean

    if (!slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN environment variable is not set');
    }

    // Post thread starter message
    const starterResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text: state.threadStarter,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const starterResult = await starterResponse.json();

    if (!starterResult.ok) {
      throw new Error(`Slack API error: ${starterResult.error}`);
    }

    // Post details as thread reply
    const replyResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text: state.threadReply,
        thread_ts: starterResult.ts,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const replyResult = await replyResponse.json();

    if (!replyResult.ok) {
      throw new Error(`Slack API error (thread reply): ${replyResult.error}`);
    }

    console.log(`Posted summary to Slack as thread`);

    return {
      ...state,
      slackResponse: {
        ok: true,
        starterTs: starterResult.ts,
        replyTs: replyResult.ts,
        channel: starterResult.channel,
      },
    };
  });

export default weeklyDevSummaryBrain;
