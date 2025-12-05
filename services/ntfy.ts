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
