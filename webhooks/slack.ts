import { createWebhook } from '@positronic/core';
import { z } from 'zod';

// Generic Slack webhook response schema
const slackWebhookSchema = z.any();

const slackWebhook = createWebhook(
  'slack',
  slackWebhookSchema,
  async (request) => {
    try {
      const contentType = request.headers.get('content-type') || '';
      let payload: any;

      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Parse form-encoded data
        const text = await request.text();
        const params = new URLSearchParams(text);
        const payloadStr = params.get('payload');
        if (!payloadStr) {
          throw new Error('No payload field in form data');
        }
        payload = JSON.parse(payloadStr);
      } else {
        // Fallback to JSON parsing (used by Events API)
        const body = await request.json() as any;
        payload = body.payload ? JSON.parse(body.payload) : body;
      }

      // Handle URL verification challenge (required for Events API setup)
      if (payload.type === 'url_verification') {
        return {
          type: 'verification' as const,
          challenge: payload.challenge
        };
      }

      // Handle Events API callbacks (message events, etc.)
      if (payload.type === 'event_callback' && payload.event) {
        const event = payload.event;

        // Handle message events in threads
        if (event.type === 'message' && event.thread_ts && !event.subtype && !event.bot_id) {
          // This is a reply to a thread from a human user (not a bot)
          return {
            type: 'webhook' as const,
            identifier: event.thread_ts, // Use parent message timestamp as identifier
            response: {
              type: 'thread_reply',
              message: {
                text: event.text,
                ts: event.ts,
                user: event.user,
                thread_ts: event.thread_ts,
              },
            },
          };
        }

        // Ignore other message events (like bot messages, edits, etc.)
        return {
          type: 'webhook' as const,
          identifier: 'ignored',
          response: { ignored: true },
        };
      }

      // Handle block actions (buttons, checkboxes, etc.)
      if (payload.type === 'block_actions') {
        // Use message timestamp + action_id as identifier
        const messageTs = payload.container?.message_ts || payload.message?.ts;
        const actionId = payload.actions?.[0]?.action_id;
        const identifier = `${messageTs}-${actionId}`;

        return {
          type: 'webhook' as const,
          identifier,
          response: payload,
        };
      }

      // Can add other Slack interaction types here as needed
      // (view_submission for modals, message_action for message shortcuts, etc.)

      throw new Error(`Unhandled Slack interaction type: ${payload.type}`);
    } catch (error) {
      console.error('Slack webhook error:', error);
      throw error;
    }
  }
);

export default slackWebhook;
