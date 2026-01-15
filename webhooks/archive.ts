import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const archiveSchema = z.object({
  threadIds: z.array(z.string()),
  confirmed: z.boolean(),
});

const archiveWebhook = createWebhook(
  'archive',
  archiveSchema,
  async (request) => {
    const contentType = request.headers.get('content-type') || '';

    if (!contentType.includes('application/x-www-form-urlencoded')) {
      throw new Error('Expected form-encoded data');
    }

    const text = await request.text();
    const params = new URLSearchParams(text);

    const sessionId = params.get('sessionId');
    const threadIdsJson = params.get('threadIds');

    if (!sessionId) {
      throw new Error('Missing sessionId in form data');
    }

    if (!threadIdsJson) {
      throw new Error('Missing threadIds in form data');
    }

    const threadIds = JSON.parse(threadIdsJson) as string[];

    return {
      type: 'webhook' as const,
      identifier: sessionId,
      response: {
        threadIds,
        confirmed: true,
      },
    };
  }
);

export default archiveWebhook;
