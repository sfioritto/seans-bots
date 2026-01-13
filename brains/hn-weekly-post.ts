import { brain } from '../brain.js';
import { aiRelatedPostsPrompt } from '../prompts/hn-weekly-post/ai-related-posts.js';
import { generateWeeklyPostPrompt } from '../prompts/hn-weekly-post/generate-weekly-post.js';
import slackWebhook from '../webhooks/slack.js';

const hnWeeklyPostBrain = brain({
  title: 'hn-weekly-post',
  description: 'Curates AI-related Hacker News stories and posts a weekly summary to Slack with feedback loop',
})
  .step('Fetch HN stories from last week', async ({ state, hn }) => {
    const recentStories = await hn.getStories({
      daysBack: 7,
      minPoints: 50,
      frontPageOnly: true,
    });

    return {
      ...state,
      recentStories,
    };
  })
  .prompt('Find AI-related posts', aiRelatedPostsPrompt)
  .step('Filter AI-related articles', ({ state }) => {
    const aiRelatedStories = state.aiRelatedStoryIds.ids
      .map((id: string) => {
        return state.recentStories.find((story) => story.id === id);
      })
      .filter((story) => story !== undefined);

    return {
      ...state,
      aiRelatedStories,
    };
  })
  .step('Fetch article content', async ({ state, hn }) => {
    const { aiRelatedStories } = state;
    const articlesWithContent = await hn.fetchStoriesContent(aiRelatedStories);

    return {
      ...state,
      aiRelatedStories: articlesWithContent,
    };
  })
  .prompt('Generate draft post', generateWeeklyPostPrompt)
  .step('Post draft for feedback', async ({ state, slack }) => {
    const slackChannelId = process.env.SLACK_CHANNEL_ID || 'UDFFLKPM5'; // DM to Sean

    // Post intro message asking for review
    const intro = await slack.sendMessage(
      slackChannelId,
      `Hey, can you review this draft and give me your feedback before I post it?`
    );

    const threadTs = intro.ts;
    const actualChannelId = intro.channel;

    // Post header as first thread reply
    await slack.sendMessage(actualChannelId, `This week's AI articles worth reading 🧵`, { threadTs });

    // Post each article line as thread replies
    const articleLines = state.weeklyPost.post.split('\n').filter((line: string) => line.trim());
    for (const line of articleLines) {
      await slack.sendMessage(actualChannelId, line, {
        threadTs,
        unfurlLinks: false,
        unfurlMedia: false,
      });
    }

    // Wait for feedback via thread reply
    return {
      state,
      waitFor: [slackWebhook(threadTs)],
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
  .step('Post final version to sw-dev', async ({ state, slack }) => {
    const swDevChannelId = 'CJ8PR3XGT';

    // Build thread messages from the final post
    const articleLines = state.finalPost.post.split('\n').filter((line: string) => line.trim());
    const threadMessages = articleLines.map((line: string) => ({
      text: line,
      unfurlLinks: false,
      unfurlMedia: false,
    }));

    // Post header with article thread replies
    const result = await slack.postThread(
      swDevChannelId,
      `This week's AI articles worth reading 🧵`,
      threadMessages
    );

    return {
      ...state,
      publishedTs: result.ts,
      publishedChannel: swDevChannelId,
    };
  });

export default hnWeeklyPostBrain;