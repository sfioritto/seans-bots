import { brain } from '../brain.js';
import { z } from 'zod';
import { slackWebhook } from '../webhooks/slack.js';

const SEAN_SLACK_ID = 'UDFFLKPM5';

const slackInterviewBrain = brain({
  title: 'slack-interview',
  description: 'Conducts an interview via Slack DM, gathering information to craft a story',
})
  // Step 1: Open DM and send initial greeting
  .step('Start interview on Slack', async ({ state, slack }) => {
    // Open DM with Sean
    const channelId = await slack.openDM(SEAN_SLACK_ID);

    // Send initial greeting
    const greeting = `Hey! I'm your personal storyteller bot. I'd love to interview you and turn your answers into a short story.

What would you like the story to be about? Some ideas:
- A memorable childhood adventure
- A challenge you overcame
- A person who changed your life
- A trip that surprised you
- Something totally different - you pick!

Just reply with what sounds interesting to you.`;

    const message = await slack.sendMessage(channelId, greeting);

    return {
      ...state,
      channelId,
      threadTs: message.ts,
    };
  })

  // Step 2: Conduct the interview loop
  // The config function runs once to set up the loop. The LLM sees the conversation
  // evolve naturally through the messages array - webhook responses are automatically
  // added as tool results by the framework.
  .loop('Conduct interview', ({ state, slack }) => {
    const { channelId, threadTs } = state;

    return {
      system: `You are conducting a friendly, engaging interview to gather material for a short story. Your goal is to draw out vivid details, emotions, and specific moments that will make for compelling storytelling.

Interview style:
- Be warm and conversational, like a friend catching up
- Ask follow-up questions that dig deeper into interesting details
- Look for sensory details (what did you see, hear, feel?)
- Ask about emotions and thoughts in the moment
- Get specific names, places, and timeframes when relevant
- Keep questions focused and one at a time

You typically need 4-6 good exchanges to gather enough material. Look for:
- A clear narrative arc (beginning, middle, end)
- At least one moment of tension or challenge
- Emotional resonance
- Vivid sensory details
- A takeaway or reflection

When you have enough rich material to write a compelling 2-3 paragraph story, use the finish_interview tool.`,

      prompt: `You've just sent Sean a greeting asking what he'd like his story to be about.

Use wait_for_reply to wait for his topic choice, then conduct the interview by asking follow-up questions with ask_question.

When you have enough material for a great story (usually 4-6 exchanges with vivid details, emotions, and a clear arc), use finish_interview.`,

      tools: {
        wait_for_reply: {
          description: 'Wait for Sean to reply in the Slack thread. Use this to pause until he responds.',
          inputSchema: z.object({}),
          execute: async () => {
            console.log('\n⏳ Waiting for Sean to reply...');
            return {
              waitFor: slackWebhook(threadTs),
            };
          },
        },

        ask_question: {
          description: 'Send a question to Sean via Slack and wait for his response.',
          inputSchema: z.object({
            question: z.string().describe('The interview question to ask'),
          }),
          execute: async (input: { question: string }) => {
            await slack.sendMessage(channelId, input.question, { threadTs });
            console.log(`\n🎤 Asked: ${input.question}`);

            return {
              waitFor: slackWebhook(threadTs),
            };
          },
        },

        finish_interview: {
          description: 'End the interview when you have gathered enough material for a compelling story. Summarize what you learned from the conversation.',
          inputSchema: z.object({
            topic: z.string().describe('The topic/theme of the story'),
            keyMoments: z.array(z.string()).describe('3-5 key moments/details to include in the story, written as prose sentences'),
            emotionalArc: z.string().describe('The emotional journey of the story in one sentence'),
          }),
          execute: async (input: { topic: string; keyMoments: string[]; emotionalArc: string }) => {
            console.log('\n✅ Interview complete!');
            console.log(`Topic: ${input.topic}`);
            console.log(`Key moments: ${input.keyMoments.join(', ')}`);
            console.log(`Emotional arc: ${input.emotionalArc}`);

            return {
              topic: input.topic,
              keyMoments: input.keyMoments,
              emotionalArc: input.emotionalArc,
            };
          },
          terminal: true,
        },
      },
    };
  })

  // Step 3: Write the story and create a page
  .step('Write story and create page', async ({ state, pages, env, slack }) => {
    const channelId = state.channelId as string;
    const threadTs = state.threadTs as string;

    // Loop terminal tool output is merged into state
    const loopState = state as typeof state & {
      topic?: string;
      keyMoments?: string[];
      emotionalArc?: string;
    };

    const topic = loopState.topic || 'Untitled';
    const keyMoments = loopState.keyMoments || [];
    const emotionalArc = loopState.emotionalArc || '';

    // For this demo, we'll craft a simple story based on the material
    // In a real version, we'd use the LLM via a prompt step
    const storyTitle = `The Story of ${topic}`;

    // Build story from the key moments
    const storyBody = `
Based on our conversation, here's a story crafted from your memories:

${keyMoments.map((moment, i) => `**${i + 1}.** ${moment}`).join('\n\n')}

*The emotional journey: ${emotionalArc}*

---

*This story was crafted from an interview conducted on ${new Date().toLocaleDateString()}.*
    `.trim();

    console.log('\n📖 Story created:');
    console.log(storyBody);

    // Create a page with the story
    if (!pages) {
      throw new Error('Pages service not available');
    }

    const slug = `story-${Date.now()}`;
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${storyTitle}</title>
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
    h1 {
      font-size: 2em;
      margin-bottom: 0.5em;
      color: #1a1a1a;
    }
    .meta {
      color: #666;
      font-style: italic;
      margin-bottom: 2em;
      padding-bottom: 1em;
      border-bottom: 1px solid #ddd;
    }
    .story {
      font-size: 1.1em;
    }
    .story p {
      margin-bottom: 1.5em;
    }
    .moment {
      background: #fff;
      padding: 20px;
      margin: 20px 0;
      border-left: 3px solid #4a90a4;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .arc {
      font-style: italic;
      color: #555;
      text-align: center;
      margin: 2em 0;
      padding: 1em;
      background: #f0f0f0;
      border-radius: 4px;
    }
    .footer {
      margin-top: 3em;
      padding-top: 1em;
      border-top: 1px solid #ddd;
      font-size: 0.9em;
      color: #888;
    }
  </style>
</head>
<body>
  <h1>${storyTitle}</h1>
  <div class="meta">An interview-based story</div>

  <div class="story">
    ${keyMoments.map(moment => `<div class="moment"><p>${moment}</p></div>`).join('\n')}

    <div class="arc">${emotionalArc}</div>
  </div>

  <div class="footer">
    This story was crafted from an interview conducted on ${new Date().toLocaleDateString()}.
  </div>
</body>
</html>`;

    await pages.create(slug, html, { persist: true });
    const pageUrl = `${env.origin}/pages/${slug}`;

    // Send the link to Slack
    const completionMessage = `✨ Your story is ready!\n\n${pageUrl}\n\nThanks for sharing with me!`;
    await slack.sendMessage(channelId, completionMessage, { threadTs });

    console.log(`\n🎉 Story page created: ${pageUrl}`);

    return {
      ...state,
      storyUrl: pageUrl,
      storyTitle,
      completed: true,
    };
  });

export default slackInterviewBrain;
