import { z } from 'zod';

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackMessageResult {
  ts: string;
  channel: string;
}

interface SlackMessage {
  text: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN not set');
  }
  return token;
}

async function apiCall<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${SLACK_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json() as { ok: boolean; error?: string } & T;
  if (!result.ok) {
    throw new Error(`Slack API error: ${result.error}`);
  }

  return result;
}

/**
 * Send a message to a Slack channel or thread
 */
async function sendMessage(
  channel: string,
  text: string,
  options?: {
    threadTs?: string;
    unfurlLinks?: boolean;
    unfurlMedia?: boolean;
  }
): Promise<SlackMessageResult> {
  const result = await apiCall<{ ts: string; channel: string }>('chat.postMessage', {
    channel,
    text,
    ...(options?.threadTs ? { thread_ts: options.threadTs } : {}),
    ...(options?.unfurlLinks !== undefined ? { unfurl_links: options.unfurlLinks } : {}),
    ...(options?.unfurlMedia !== undefined ? { unfurl_media: options.unfurlMedia } : {}),
  });

  return { ts: result.ts, channel: result.channel };
}

/**
 * Open a DM channel with a user
 */
async function openDM(userId: string): Promise<string> {
  const result = await apiCall<{ channel: { id: string } }>('conversations.open', {
    users: userId,
  });

  return result.channel.id;
}

/**
 * Post a main message followed by thread replies
 */
async function postThread(
  channel: string,
  mainMessage: string,
  threadMessages: SlackMessage[]
): Promise<SlackMessageResult> {
  // Post the main message
  const main = await sendMessage(channel, mainMessage);

  // Post each thread reply
  for (const msg of threadMessages) {
    await sendMessage(channel, msg.text, {
      threadTs: main.ts,
      unfurlLinks: msg.unfurlLinks,
      unfurlMedia: msg.unfurlMedia,
    });
  }

  return main;
}

export default {
  sendMessage,
  openDM,
  postThread,
};

// =============================================================================
// AI-callable tools
// =============================================================================

export const slackSendMessage = {
  description: 'Send a message to a Slack channel or thread',
  inputSchema: z.object({
    channel: z.string().describe('Channel ID or name (e.g., "#general" or "C1234567890")'),
    text: z.string().describe('The message text to send'),
    threadTs: z.string().optional().describe('Thread timestamp to reply to (for threaded messages)'),
    unfurlLinks: z.boolean().optional().describe('Whether to unfurl links in the message'),
    unfurlMedia: z.boolean().optional().describe('Whether to unfurl media in the message'),
  }),
  execute: async (input: {
    channel: string;
    text: string;
    threadTs?: string;
    unfurlLinks?: boolean;
    unfurlMedia?: boolean;
  }) => {
    return sendMessage(input.channel, input.text, {
      threadTs: input.threadTs,
      unfurlLinks: input.unfurlLinks,
      unfurlMedia: input.unfurlMedia,
    });
  },
};

export const slackOpenDM = {
  description: 'Open a direct message channel with a Slack user',
  inputSchema: z.object({
    userId: z.string().describe('The Slack user ID to open a DM with'),
  }),
  execute: async (input: { userId: string }) => {
    return openDM(input.userId);
  },
};

export const slackPostThread = {
  description: 'Post a main message followed by thread replies',
  inputSchema: z.object({
    channel: z.string().describe('Channel ID or name'),
    mainMessage: z.string().describe('The main message text'),
    threadMessages: z.array(z.object({
      text: z.string().describe('Thread reply text'),
      unfurlLinks: z.boolean().optional(),
      unfurlMedia: z.boolean().optional(),
    })).describe('Array of messages to post as thread replies'),
  }),
  execute: async (input: {
    channel: string;
    mainMessage: string;
    threadMessages: Array<{ text: string; unfurlLinks?: boolean; unfurlMedia?: boolean }>;
  }) => {
    return postThread(input.channel, input.mainMessage, input.threadMessages);
  },
};

export const slackTools = {
  slackSendMessage,
  slackOpenDM,
  slackPostThread,
};
