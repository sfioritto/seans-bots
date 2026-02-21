import { brain } from '../brain.js';
import { z } from 'zod';
import slackWebhook from '../webhooks/slack.js';

const SEAN_SLACK_ID = 'UDFFLKPM5';

const slackInterviewBrain = brain('slack-interview', ({ slack, pages, env }) => ({
    system: `You are a friendly storyteller bot that conducts interviews via Slack and turns the responses into short stories.

Your workflow:
1. First, call open_dm to get a channelId
2. Send a greeting message using send_message with that channelId - this returns a "ts" (timestamp) which becomes your threadTs
3. Call wait_for_reply with the threadTs to wait for Sean's response
4. The wait_for_reply result contains Sean's message text in response.message.text
5. Continue the interview by calling send_message (with channelId and threadTs) then wait_for_reply
6. After 4-6 exchanges with vivid details, create a story page and share the link
7. Call finish when done

IMPORTANT - Threading values through tool calls:
- open_dm returns { channelId } - save this for all send_message calls
- send_message returns { ts } - the first message's ts becomes your threadTs for the conversation
- wait_for_reply returns { response: { message: { text, thread_ts } } } - the text is Sean's reply
- Always pass channelId and threadTs to send_message after the first message

Interview style:
- Be warm and conversational, like a friend catching up
- Ask follow-up questions that dig deeper into interesting details
- Look for sensory details (what did you see, hear, feel?)
- Ask about emotions and thoughts in the moment
- Get specific names, places, and timeframes when relevant
- Keep questions focused and one at a time

For the story, look for:
- A clear narrative arc (beginning, middle, end)
- At least one moment of tension or challenge
- Emotional resonance
- Vivid sensory details
- A takeaway or reflection`,

    prompt: `Start by opening a DM with Sean and sending a friendly greeting that asks what topic he'd like his story to be about.

Suggested greeting ideas to offer:
- A memorable childhood adventure
- A challenge you overcame
- A person who changed your life
- A trip that surprised you
- Or something totally different

Then conduct the interview, and when you have enough rich material, create a story page and share it with him.`,

    tools: {
      open_dm: {
        description: 'Open a direct message channel with Sean. Call this first before sending any messages. Returns { channelId } which you need for send_message.',
        inputSchema: z.object({}),
        execute: async () => {
          const channelId = await slack.openDM(SEAN_SLACK_ID);
          console.log(`\n📬 Opened DM channel: ${channelId}`);
          return { channelId };
        },
      },

      send_message: {
        description: 'Send a message to Sean. Returns { ts } - the first message ts becomes your threadTs for the conversation.',
        inputSchema: z.object({
          channelId: z.string().describe('The channel ID from open_dm'),
          message: z.string().describe('The message to send'),
          threadTs: z.string().optional().describe('The thread timestamp - omit for first message, include for replies'),
        }),
        execute: async ({ channelId, message, threadTs }: { channelId: string; message: string; threadTs?: string }) => {
          const result = await slack.sendMessage(channelId, message, threadTs ? { threadTs } : undefined);
          console.log(`\n💬 Sent: ${message.substring(0, 50)}...`);
          return { ts: result.ts };
        },
      },

      wait_for_reply: {
        description: 'Wait for Sean to reply in the Slack thread. Returns { response: { message: { text, thread_ts } } } with his reply.',
        inputSchema: z.object({
          threadTs: z.string().describe('The thread timestamp to wait for replies on'),
        }),
        execute: async ({ threadTs }: { threadTs: string }) => {
          console.log('\n⏳ Waiting for Sean to reply...');
          return {
            waitFor: slackWebhook(threadTs),
          };
        },
      },

        create_story_page: {
          description: 'Create an HTML page with the story and return its URL. Call this when you have gathered enough material and are ready to write the story.',
          inputSchema: z.object({
            title: z.string().describe('The title of the story'),
            keyMoments: z.array(z.string()).describe('3-5 key moments/details written as prose sentences'),
            emotionalArc: z.string().describe('The emotional journey of the story in one sentence'),
          }),
          execute: async ({ title, keyMoments, emotionalArc }: { title: string; keyMoments: string[]; emotionalArc: string }) => {
            if (!pages) {
              return { error: 'Pages service not available' };
            }
            const slug = `story-${Date.now()}`;
            const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: Georgia, 'Times New Roman', serif;
      max-width: 650px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #faf9f6;
      color: #333;
      line-height: 1.8;
    }
    h1 { font-size: 2em; margin-bottom: 0.5em; color: #1a1a1a; }
    .meta { color: #666; font-style: italic; margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #ddd; }
    .story { font-size: 1.1em; }
    .moment { background: #fff; padding: 20px; margin: 20px 0; border-left: 3px solid #4a90a4; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .arc { font-style: italic; color: #555; text-align: center; margin: 2em 0; padding: 1em; background: #f0f0f0; border-radius: 4px; }
    .footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #ddd; font-size: 0.9em; color: #888; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">An interview-based story</div>
  <div class="story">
    ${keyMoments.map(moment => `<div class="moment"><p>${moment}</p></div>`).join('\n')}
    <div class="arc">${emotionalArc}</div>
  </div>
  <div class="footer">This story was crafted from an interview conducted on ${new Date().toLocaleDateString()}.</div>
</body>
</html>`;

            await pages.create(slug, html, { persist: true });
            const pageUrl = `${env.origin}/pages/${slug}`;
            console.log(`\n📖 Story page created: ${pageUrl}`);
            return { pageUrl, slug };
          },
        },

        finish: {
          description: 'Complete the interview process. Call this after you have shared the story link with Sean.',
          inputSchema: z.object({
            storyUrl: z.string().describe('The URL of the created story page'),
            storyTitle: z.string().describe('The title of the story'),
          }),
          terminal: true,
        },
      },
    }));

export default slackInterviewBrain;
