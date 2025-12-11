import { brain } from '../brain.js';
import { developerSummaryPrompt } from '../prompts/weekly-dev-summary/developer-summary.js';

const weeklyDevSummaryBrain = brain({
  title: 'weekly-dev-summary',
  description: 'Aggregates GitHub PR activity and generates developer summaries for Slack',
})
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

  .step('Aggregate PR authors', ({ state }) => {
    const githubUsernames = [...new Set(state.rawPRs.map((pr: any) => pr.author))];

    console.log(`[DEBUG] Aggregate: ${githubUsernames.length} unique PR authors`);
    console.log(`[DEBUG] Aggregate: github usernames = ${githubUsernames.join(', ')}`);

    return {
      ...state,
      githubUsernames,
    };
  })

  .step('Build developer data from PRs', ({ state }) => {
    const { githubUsernames, rawPRs, reviewsByUser, commentsByUser } = state;

    // Filter out bots
    const filteredUsernames = githubUsernames.filter((u: string) =>
      !u.toLowerCase().includes('bot') && !u.toLowerCase().includes('actions')
    );

    // Build developer data from GitHub usernames
    const developers = filteredUsernames.map((username: string) => {
      const lowerUsername = username.toLowerCase();
      const prs = rawPRs.filter((pr: any) => pr.author.toLowerCase() === lowerUsername);

      return {
        name: username,
        githubUsername: username,
        prs,
        meta: {
          totalPRs: prs.length,
          prsReviewed: reviewsByUser[lowerUsername] || 0,
          prComments: commentsByUser[lowerUsername] || 0,
        },
      };
    });

    console.log(`[DEBUG] Built ${developers.length} developers from PR data`);
    for (const dev of developers) {
      console.log(`[DEBUG] Dev: ${dev.name} - ${dev.meta.totalPRs} PRs, ${dev.meta.prsReviewed} reviews, ${dev.meta.prComments} comments`);
    }

    return {
      ...state,
      developers,
    };
  })

  .prompt('Generate developer summaries', developerSummaryPrompt)

  .step('Format Slack message', ({ state }) => {
    const { developerSummaries, developers, weekStart } = state;

    console.log(`[DEBUG] Summary AI returned ${developerSummaries.summaries.length} summaries`);
    for (const sum of developerSummaries.summaries) {
      console.log(`[DEBUG] Summary for: ${sum.name} - has summary: ${!!sum.summary}`);
    }
    console.log(`[DEBUG] Input developers: ${developers.length}, Output summaries: ${developerSummaries.summaries.length}`);

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

    if (!slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN environment variable is not set');
    }

    // Open a group DM with Sean and Jim
    const conversationResponse = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        users: 'UDFFLKPM5,U046M09P1JA', // Sean and Jim
      }),
    });

    const conversationResult = await conversationResponse.json();

    if (!conversationResult.ok) {
      throw new Error(`Slack API error (conversations.open): ${conversationResult.error}`);
    }

    const channelId = conversationResult.channel.id;

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
