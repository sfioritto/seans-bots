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
  .step('Fetch article content', async ({ state }) => {
    console.log(`Fetching content for ${state.filteredArticles.length} articles...`);

    // Fetch content for each article
    const articlesWithContent = await Promise.all(
      state.filteredArticles.map(async (article: any) => {
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

    console.log(`Successfully fetched content for ${articlesWithContent.filter((a: any) => a.content).length} articles`);

    return {
      ...state,
      filteredArticles: articlesWithContent,
    };
  })
  .prompt('Generate draft post', generateWeeklyPostPrompt)
  .step('Post draft for feedback', async ({ state }) => {
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const slackChannelId = process.env.SLACK_CHANNEL_ID || 'UDFFLKPM5'; // DM to Sean

    if (!slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN is not set');
    }

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

    // Post the draft with instructions and a "Done" button
    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📝 Weekly AI News Draft',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Here's the first draft based on ${state.filteredArticles.length} AI-related articles from Hacker News this week:\n\n*Reply to this thread* with any changes you'd like, then click Done below.`,
        },
      },
      {
        type: 'divider',
      },
    ];

    // Add chunks as separate section blocks
    for (const chunk of chunks) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: chunk,
        },
      });
    }

    // Add final divider and button
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
              text: '✅ Done - regenerate with feedback',
            },
            style: 'primary',
            action_id: 'submit_feedback',
            value: 'done',
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
        text: 'Weekly AI News Draft',
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('Slack API error:', result);
      throw new Error(`Slack API error: ${result.error}`);
    }

    const messageTs = result.ts;
    const actualChannelId = result.channel; // Use the actual channel ID from Slack's response
    console.log(`Sent draft message to Slack: ${messageTs} in channel ${actualChannelId}`);

    // Wait for the "Done" button click
    // Meanwhile, the webhook will collect thread replies with this messageTs as thread_ts
    return {
      state: {
        ...state,
        draftMessageTs: messageTs,
        slackChannelId: actualChannelId, // Store the actual channel ID, not the user ID
      },
      waitFor: [slackWebhook(`${messageTs}-submit_feedback`)],
    };
  })
  .step('Collect feedback from thread', async ({ state }) => {
    // Fetch all thread replies to collect feedback
    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const response = await fetch(
      `https://slack.com/api/conversations.replies?channel=${state.slackChannelId}&ts=${state.draftMessageTs}`,
      {
        headers: {
          'Authorization': `Bearer ${slackBotToken}`,
        },
      }
    );

    const result = await response.json();

    if (!result.ok) {
      console.error('Failed to fetch thread replies:', result);
      throw new Error(`Slack API error: ${result.error}`);
    }

    // Filter out the original message and bot messages, keep only user feedback
    const feedbackMessages = result.messages
      .filter((msg: any) => msg.ts !== state.draftMessageTs && !msg.bot_id)
      .map((msg: any) => ({
        text: msg.text,
        ts: msg.ts,
      }));

    console.log(`Collected ${feedbackMessages.length} feedback messages`);

    return {
      ...state,
      feedbackMessages,
    };
  })
  .step('Check if regeneration needed', ({ state }) => {
    // If there's no feedback, skip regeneration
    if (!state.feedbackMessages || state.feedbackMessages.length === 0) {
      console.log('No feedback received, using original draft');
      return state;
    }

    console.log(`Will regenerate post with ${state.feedbackMessages.length} feedback messages`);
    return state;
  })
  .prompt('Regenerate with feedback', {
    template: (state: any) => {
      // If no feedback, just return the original post
      if (!state.feedbackMessages || state.feedbackMessages.length === 0) {
        return generateWeeklyPostPrompt.template({ filteredArticles: state.filteredArticles });
      }

      // Otherwise regenerate with feedback
      return generateWeeklyPostPrompt.template({
        filteredArticles: state.filteredArticles,
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