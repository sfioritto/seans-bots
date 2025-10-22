import { createWebhook } from '@positronic/core';
import { z } from 'zod';

// Generic Slack webhook response schema
const slackWebhookSchema = z.any();

export const slackWebhook = createWebhook(
  'slack',
  slackWebhookSchema,
  async (request) => {
    try {
      // Slack sends interactive payloads as form-encoded data
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
        // Fallback to JSON parsing
        const body = await request.json() as any;
        payload = body.payload ? JSON.parse(body.payload) : body;
      }

      console.log('Slack webhook received:', {
        type: payload.type,
        action_id: payload.actions?.[0]?.action_id,
      });

      // Handle block actions (buttons, checkboxes, etc.)
      if (payload.type === 'block_actions') {
        // Use message timestamp + action_id as identifier
        const messageTs = payload.container?.message_ts || payload.message?.ts;
        const actionId = payload.actions?.[0]?.action_id;
        const identifier = `${messageTs}-${actionId}`;

        console.log(`Webhook identifier: ${identifier}`);

        return {
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
