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

    // Users to ignore
    const ignoredUsers = ['dependabot', 'dependabot[bot]', 'sofware', 'claude'];

    // Filter out merge commits and ignored users
    const filteredCommits = allCommits.filter(commit => {
      const message = commit.message.toLowerCase();
      const authorName = commit.author?.name?.toLowerCase() || '';
      const authorEmail = commit.author?.email?.toLowerCase() || '';

      const isMerge = message.startsWith('merge pull request') ||
                      message.startsWith('merge branch') ||
                      message.match(/^merge [a-f0-9]+ into/);

      const isIgnoredUser = ignoredUsers.some(user =>
        authorName.includes(user) || authorEmail.includes(user)
      );

      return !isMerge && !isIgnoredUser;
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

    // Users to ignore
    const ignoredUsers = ['dependabot', 'dependabot[bot]', 'sofware', 'claude'];

    for (const { owner, repo } of repos) {
      const prs = await github.getMergedPRs(owner, repo, new Date(state.weekStart));
      allPRs.push(...prs);
      await new Promise(r => setTimeout(r, 100));
    }

    // Filter out ignored users
    const filteredPRs = allPRs.filter(pr => {
      const author = pr.author?.toLowerCase() || '';
      return !ignoredUsers.some(user => author.includes(user));
    });

    console.log(`Fetched ${allPRs.length} merged PRs, ${filteredPRs.length} after filtering`);

    return {
      ...state,
      rawPRs: filteredPRs,
    };
  })

  .step('Fetch PR reviews and comments', async ({ state, github }) => {
    const repos = github.getRepoList();
    const allReviews: { user: string; count: number }[] = [];
    const allComments: { user: string; count: number }[] = [];

    for (const { owner, repo } of repos) {
      const reviews = await github.getPRReviews(owner, repo, new Date(state.weekStart));
      allReviews.push(...reviews);

      const comments = await github.getPRReviewComments(owner, repo, new Date(state.weekStart));
      allComments.push(...comments);

      await new Promise(r => setTimeout(r, 100));
    }

    // Aggregate by user
    const reviewsByUser = new Map<string, number>();
    for (const { user, count } of allReviews) {
      reviewsByUser.set(user, (reviewsByUser.get(user) || 0) + count);
    }

    const commentsByUser = new Map<string, number>();
    for (const { user, count } of allComments) {
      commentsByUser.set(user, (commentsByUser.get(user) || 0) + count);
    }

    console.log(`Fetched reviews from ${reviewsByUser.size} reviewers, comments from ${commentsByUser.size} commenters`);

    return {
      ...state,
      reviewsByUser: Object.fromEntries(reviewsByUser),
      commentsByUser: Object.fromEntries(commentsByUser),
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
    const { nameDeduplication, developerData, rawPRs, reviewsByUser, commentsByUser } = state;

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
      githubUsernames: string[];
      commits: any[];
      prs: any[];
      meta: {
        additions: number;
        deletions: number;
        totalCommits: number;
        totalPRs: number;
        prsReviewed: number;
        prComments: number;
      };
    }>();

    for (const dev of developerData) {
      const canonical = emailToCanonical.get(dev.email.toLowerCase()) || dev.names[0];

      if (!mergedDevelopers.has(canonical)) {
        mergedDevelopers.set(canonical, {
          name: canonical,
          emails: [],
          githubUsernames: canonicalToUsernames.get(canonical) || [],
          commits: [],
          prs: [],
          meta: {
            additions: 0,
            deletions: 0,
            totalCommits: 0,
            totalPRs: 0,
            prsReviewed: 0,
            prComments: 0,
          },
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

    // Calculate metadata for each developer
    for (const [canonical, dev] of mergedDevelopers) {
      // Calculate additions/deletions from commits
      for (const commit of dev.commits) {
        dev.meta.additions += commit.stats?.additions || 0;
        dev.meta.deletions += commit.stats?.deletions || 0;
      }
      dev.meta.totalCommits = dev.commits.length;
      dev.meta.totalPRs = dev.prs.length;

      // Get reviews and comments by matching GitHub usernames
      for (const username of dev.githubUsernames) {
        const lowerUsername = username.toLowerCase();
        dev.meta.prsReviewed += reviewsByUser[lowerUsername] || 0;
        dev.meta.prComments += commentsByUser[lowerUsername] || 0;
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
    const { developerSummaries, developers, weekStart } = state;

    const formatDate = (isoString: string) => {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    };

    // Build a map of developer metadata by name
    const metaByName = new Map<string, any>();
    for (const dev of developers) {
      metaByName.set(dev.name, dev.meta);
    }

    // Thread starter message
    const threadStarter = `Developer Summary for week of ${formatDate(weekStart)} 🧵`;

    // Full details for thread reply
    const sections = developerSummaries.summaries
      .filter((dev: any) => dev.summary)
      .map((dev: any) => {
        const meta = metaByName.get(dev.name) || {};

        // Format metadata bullets
        const metaBullets = [
          `• +${meta.additions || 0}/-${meta.deletions || 0} lines changed`,
          `• ${meta.totalCommits || 0} commits`,
          `• ${meta.totalPRs || 0} PRs merged`,
          `• ${meta.prsReviewed || 0} PRs reviewed`,
          `• ${meta.prComments || 0} PR comments`,
        ].join('\n\n');

        // Format accomplishment bullets with PR links
        const summaryBullets = dev.accomplishments && dev.accomplishments.length > 0
          ? dev.accomplishments.map((a: any) => {
              const prLinks = a.relatedPRs && a.relatedPRs.length > 0
                ? ' ' + a.relatedPRs.map((pr: any) =>
                    `<https://github.com/SOFware/${pr.repo}/pull/${pr.number}|#${pr.number}>`
                  ).join(' ')
                : '';
              return `• ${a.text}${prLinks}`;
            }).join('\n\n')
          : '';

        return `*${dev.name}*\n\n${metaBullets}\n\n_${dev.summary}_\n\nSummary:\n\n${summaryBullets}`;
      })
      .join('\n\n---\n\n');

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
