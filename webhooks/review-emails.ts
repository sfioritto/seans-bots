import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const reviewResponseSchema = z.object({
  action: z.enum(['acknowledge', 'draft_response', 'dismiss']),
});

export const reviewEmailsWebhook = createWebhook(
  'review-emails',
  reviewResponseSchema,
  async (request) => {
    const contentType = request.headers.get('content-type') || '';

    let sessionId: string | null = null;
    let action: string | null = null;

    if (contentType.includes('application/json')) {
      const body = await request.json() as Record<string, unknown>;
      sessionId = body.sessionId as string;
      action = body.action as string;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      sessionId = params.get('sessionId');
      action = params.get('action');
    } else {
      throw new Error('Expected JSON or form-encoded data');
    }

    if (!sessionId) {
      throw new Error('Missing sessionId');
    }

    if (!action || !['acknowledge', 'draft_response', 'dismiss'].includes(action)) {
      throw new Error('Invalid action - must be acknowledge, draft_response, or dismiss');
    }

    return {
      type: 'webhook' as const,
      identifier: sessionId,
      response: {
        action: action as 'acknowledge' | 'draft_response' | 'dismiss',
      },
    };
  }
);
