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
