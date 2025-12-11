import { brain } from '../brain.js';
import { aiRelatedPostsPrompt } from '../prompts/hn-weekly-post/ai-related-posts.js';
import { generateWeeklyPostPrompt } from '../prompts/hn-weekly-post/generate-weekly-post.js';
import { slackWebhook } from '../webhooks/slack.js';

const hnWeeklyPostBrain = brain({
  title: 'hn-weekly-post',
  description: 'Curates AI-related Hacker News stories and posts a weekly summary to Slack with feedback loop',
})
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
    const aiRelatedStories = state.aiRelatedStoryIds.ids
      .map((id: number) => {
        return state.recentStories.find((story: any) => Number(story.id) === Number(id));
      })
      .filter((story) => story !== undefined);

    return {
      ...state,
      aiRelatedStories,
    };
  })
  .step('Fetch article content', async ({ state }) => {
    const { aiRelatedStories } = state;
    // Fetch content for each article
    const articlesWithContent = await Promise.all(
      aiRelatedStories.map(async (article) => {
        try {
          const response = await fetch(article.url);
          const html = await response.text();

          // Basic content extraction - remove HTML tags and get first 1500 chars
          const text = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          return {
            ...article,
            content: text.slice(0, 1500),
          };
        } catch (error) {
          console.error(`Failed to fetch content for ${article.title}:`, error);
          return {
            ...article,
            content: undefined,
          };
        }
      })
    );

    return {
      ...state,
      aiRelatedStories: articlesWithContent,
    };
  })
  .prompt('Generate draft post', generateWeeklyPostPrompt)
  .step('Post draft for feedback', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const slackChannelId = process.env.SLACK_CHANNEL_ID || 'UDFFLKPM5'; // DM to Sean

    if (!slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN is not set');
    }

    // First, post the intro message asking for review
    const introResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: slackChannelId,
        text: `Hey, can you review this draft and give me your feedback before I post it?`,
      }),
    });

    const introResult = await introResponse.json();

    if (!introResult.ok) {
      console.error('Slack API error:', introResult);
      throw new Error(`Slack API error: ${introResult.error}`);
    }

    const threadTs = introResult.ts;
    const actualChannelId = introResult.channel;

    // Post the static header as first thread reply
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: actualChannelId,
        thread_ts: threadTs,
        text: `This week's AI articles worth reading 🧵`,
      }),
    });

    // Post each article summary as a separate thread reply
    const articleLines = state.weeklyPost.post.split('\n').filter((line: string) => line.trim());

    for (const articleLine of articleLines) {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: actualChannelId,
          thread_ts: threadTs,
          text: articleLine,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
    }

    // Wait for the first thread reply (webhook will be triggered)
    return {
      state,
      waitFor: [slackWebhook(threadTs)], // Wait for thread reply
    };
  })
  .step('Extract feedback from webhook', ({ state, response }) => {
    // The webhook gives us the thread reply directly
    const webhookResponse = response;
    const feedbackText = webhookResponse.message.text;

    // Package it in the format expected by the regeneration prompt
    const feedbackMessages = [{
      text: feedbackText,
      ts: webhookResponse.message.ts,
    }];

    return {
      ...state,
      feedbackMessages,
    };
  })
  .prompt('Regenerate with feedback', {
    template: (state: any) => {
      return generateWeeklyPostPrompt.template({
        aiRelatedStories: state.aiRelatedStories,
        previousDraft: state.weeklyPost?.post,
        feedbackMessages: state.feedbackMessages,
      });
    },
    outputSchema: {
      schema: generateWeeklyPostPrompt.outputSchema.schema,
      name: 'finalPost' as const,
    },
  })
  .step('Post final version to sw-dev', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const swDevchannelId = 'CJ8PR3XGT';

    // Post the static header as the main message
    const headerResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: swDevchannelId,
        text: `This week's AI articles worth reading 🧵`,
      }),
    });

    const headerResult = await headerResponse.json();

    if (!headerResult.ok) {
      console.error('Failed to post final version:', headerResult);
      throw new Error(`Slack API error: ${headerResult.error}`);
    }

    const threadTs = headerResult.ts;

    // Post each article summary as a separate thread reply
    const articleLines = state.finalPost.post.split('\n').filter((line: string) => line.trim());

    for (const articleLine of articleLines) {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: swDevchannelId,
          thread_ts: threadTs,
          text: articleLine,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
    }

    return {
      ...state,
      publishedTs: threadTs,
      publishedChannel: swDevchannelId,
    };
  });

export default hnWeeklyPostBrain;