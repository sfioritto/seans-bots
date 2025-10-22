import { brain } from '../brain.js';
import { aiRelatedPostsPrompt } from '../prompts/hn-weekly-post/ai-related-posts.js';
import { slackWebhook } from '../webhooks/slack.js';

const hnWeeklyPostBrain = brain('hn-weekly-post')
  .step('Fetch HN stories from last week', async ({ state }) => {
    // Get the timestamp for one week ago (Algolia uses seconds)
    const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

    // Fetch all pages of results
    let allStories: any[] = [];
    let page = 0;
    let nbPages = 1;

    while (page < nbPages) {
      // Use Algolia HN Search API to get stories from the last week
      // Filter for front page stories with > 100 points
      const response = await fetch(
        `http://hn.algolia.com/api/v1/search_by_date?tags=(story,front_page)&numericFilters=created_at_i>${oneWeekAgo},points>50&hitsPerPage=1000&page=${page}`
      );

      const data = await response.json();
      nbPages = data.nbPages;
      allStories = allStories.concat(data.hits);
      page++;
    }

    // Filter to only include stories with URLs and sort by points
    const recentStories = allStories
      .filter((story: any) => story.url)
      .sort((a: any, b: any) => b.points - a.points)
      .map((story: any) => ({
        id: story.objectID,
        title: story.title,
        url: story.url,
        score: story.points,
        time: story.created_at_i,
      }));

    return {
      ...state,
      recentStories,
    };
  })
  .prompt('Find AI-related posts', aiRelatedPostsPrompt)
  .step('Filter AI-related articles', ({ state }) => {
    const filteredArticles = state.aiRelatedPosts.articleIds
      .map((id: number) => {
        return state.recentStories.find((story: any) => Number(story.id) === Number(id));
      })
      .filter((story): story is { id: any; title: any; url: any; score: any; time: any } => story !== undefined);

    console.log(`Found ${filteredArticles.length} AI-related articles`);

    return {
      ...state,
      filteredArticles,
    };
  })
  .step('Send to Slack and wait for feedback', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const slackChannelId = process.env.SLACK_CHANNEL_ID || 'UDFFLKPM5'; // DM to Sean

    if (!slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN is not set');
    }

    // Slack limits checkboxes to 10 options max, so take top 10
    const articlesForReview = state.filteredArticles.slice(0, 10);

    // Build the Slack message with checkboxes
    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 AI Articles from Hacker News',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Found *${state.filteredArticles.length}* AI-related articles from the last week. Showing top ${articlesForReview.length}.\n\nUncheck any you don't want, then click Submit:`,
        },
      },
      {
        type: 'divider',
      },
    ];

    // Create checkbox options (max 10 due to Slack limitation)
    const checkboxOptions = articlesForReview.map((article: any) => ({
      text: {
        type: 'plain_text',
        text: `${article.title} (${article.score} points)`,
      },
      description: {
        type: 'plain_text',
        text: article.url,
      },
      value: `${article.id}`,
    }));

    // Add checkboxes (all checked by default via initial_options)
    blocks.push({
      type: 'actions',
      block_id: 'article_selection',
      elements: [
        {
          type: 'checkboxes',
          action_id: 'selected_articles',
          initial_options: checkboxOptions, // Pre-check all
          options: checkboxOptions,
        },
      ],
    });

    // Add submit button
    blocks.push(
      {
        type: 'divider',
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Submit Selection',
            },
            style: 'primary',
            action_id: 'submit_selection',
            value: 'submit',
          },
        ],
      }
    );

    // Send message to Slack
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: slackChannelId,
        blocks,
        text: `Found ${state.filteredArticles.length} AI articles from HN`,
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('Slack API error:', result);
      console.error('Blocks sent:', JSON.stringify(blocks, null, 2));
      throw new Error(`Slack API error: ${result.error}`);
    }

    const messageTs = result.ts;
    console.log(`Sent message to Slack: ${messageTs}`);

    // Return state and waitFor to pause the brain
    // Wait for the submit button click
    return {
      state: {
        ...state,
        slackMessageTs: messageTs,
        slackChannelId,
        articlesForReview, // Store the articles we showed for review
      },
      waitFor: [slackWebhook(`${messageTs}-submit_selection`)],
    };
  })
  .step('Process selected articles', ({ state, response }) => {
    // Extract selected article IDs from the Slack payload
    const payload = response as any;
    const checkboxState = payload.state?.values?.article_selection?.selected_articles;
    const selectedArticleIds = checkboxState?.selected_options?.map(
      (option: any) => option.value
    ) || [];

    console.log(`User selected ${selectedArticleIds.length} articles`);

    // Filter to only the articles the user selected from the review list
    const articlesForReview = state.articlesForReview as Array<{
      id: any;
      title: any;
      url: any;
      score: any;
      time: any;
    }>;

    const selectedArticles = articlesForReview.filter((article) =>
      selectedArticleIds.includes(String(article.id))
    );

    console.log(`User kept ${selectedArticles.length} out of ${articlesForReview.length} articles`);

    return {
      ...state,
      selectedArticles,
    };
  });

export default hnWeeklyPostBrain;