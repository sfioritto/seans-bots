import { z } from 'zod';

/**
 * NTFY service for sending push notifications
 */

export const ntfy = {
  /**
   * Send a notification to the configured NTFY topic
   * @param message - The notification message
   * @param clickUrl - Optional URL to open when notification is clicked
   */
  send: async (message: string, clickUrl?: string): Promise<void> => {
    const topic = process.env.NTFY_TOPIC;
    if (!topic) {
      console.log('NTFY_TOPIC not configured, skipping notification');
      return;
    }

    const headers: HeadersInit = {};
    if (clickUrl) {
      headers['Click'] = clickUrl;
    }

    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers,
      body: message,
    });
  },
};

export default ntfy;

// =============================================================================
// AI-callable tools
// =============================================================================

export const ntfySend = {
  description: 'Send a push notification to the user. This is the primary way to reach out and communicate with the user - use it whenever you need to notify them about something, share a link, or get their attention.',
  inputSchema: z.object({
    message: z.string().describe('The notification message to send'),
    clickUrl: z.string().optional().describe('Optional URL to open when notification is clicked'),
  }),
  execute: async (input: { message: string; clickUrl?: string }) => {
    await ntfy.send(input.message, input.clickUrl);
    return { success: true };
  },
};

export const ntfyTools = {
  ntfySend,
};
