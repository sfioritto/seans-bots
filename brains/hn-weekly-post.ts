import { brain } from '../brain.js';
import { aiRelatedPostsPrompt } from '../prompts/hn-weekly-post/ai-related-posts.js';
import { generateWeeklyPostPrompt } from '../prompts/hn-weekly-post/generate-weekly-post.js';
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
    const filteredStories = state.aiRelatedPosts.articleIds
      .map((id: number) => {
        return state.recentStories.find((story: any) => Number(story.id) === Number(id));
      })
      .filter((story) => story !== undefined);

    return {
      ...state,
      filteredStories,
    };
  })
  .step('Fetch article content', async ({ state }) => {
    // Fetch content for each article
    const articlesWithContent = await Promise.all(
      state.filteredStories.map(async (article: any) => {
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
      filteredStories: articlesWithContent,
    };
  })
  .prompt('Generate draft post', generateWeeklyPostPrompt)
  .step('Post draft for feedback', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const slackChannelId = process.env.SLACK_CHANNEL_ID || 'UDFFLKPM5'; // DM to Sean

    if (!slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN is not set');
    }

    // First, post the intro message
    const introResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: slackChannelId,
        text: `Hey, can you review this and give me your feedback before I post it? 🧵`,
      }),
    });

    const introResult = await introResponse.json();

    if (!introResult.ok) {
      console.error('Slack API error:', introResult);
      throw new Error(`Slack API error: ${introResult.error}`);
    }

    const threadTs = introResult.ts;
    const actualChannelId = introResult.channel;

    // Now post the draft content as a threaded reply
    // Split the post into chunks to avoid Slack's 3000 character block limit
    const postContent = state.weeklyPost.post;
    const maxChunkSize = 2900; // Leave buffer for safety
    const chunks: string[] = [];

    let currentChunk = '';
    const lines = postContent.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxChunkSize) {
        // Current chunk is full, save it and start new one
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    const draftBlocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Draft based on ${state.filteredStories.length} AI-related articles from Hacker News this week:*`,
        },
      },
      {
        type: 'divider',
      },
    ];

    // Add chunks as separate section blocks
    for (const chunk of chunks) {
      draftBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: chunk,
        },
      });
    }

    // Post the draft as a threaded reply
    const draftResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: actualChannelId,
        thread_ts: threadTs, // Reply in the thread
        blocks: draftBlocks,
        text: 'Weekly AI News Draft',
      }),
    });

    const draftResult = await draftResponse.json();

    if (!draftResult.ok) {
      console.error('Slack API error:', draftResult);
      throw new Error(`Slack API error: ${draftResult.error}`);
    }

    // Wait for the first thread reply (webhook will be triggered)
    return {
      state: {
        ...state,
        threadTs,
        slackChannelId: actualChannelId,
      },
      waitFor: [slackWebhook(threadTs)], // Wait for thread reply
    };
  })
  .step('Extract feedback from webhook', ({ state, response }) => {
    // The webhook gives us the thread reply directly
    const webhookResponse = response as any;
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
        filteredStories: state.filteredStories,
        previousDraft: state.weeklyPost.post,
        feedbackMessages: state.feedbackMessages,
      });
    },
    outputSchema: {
      schema: generateWeeklyPostPrompt.outputSchema.schema,
      name: 'regeneratedPost' as const,
    },
  })
  .step('Set final post', ({ state }) => ({
    ...state,
    finalPost: state.regeneratedPost.post,
  }))
  .step('Post final version to public channel', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    // TODO: Replace with your actual public channel ID
    const publicChannelId = 'C051SLV9Z9V'; // Replace with actual channel ID

    const postToSend = state.finalPost;

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: publicChannelId,
        text: postToSend,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('Failed to post to public channel:', result);
      throw new Error(`Slack API error: ${result.error}`);
    }

    console.log(`Successfully posted to public channel: ${publicChannelId}`);

    return {
      ...state,
      publishedTs: result.ts,
      publishedChannel: publicChannelId,
    };
  });

export default hnWeeklyPostBrain;