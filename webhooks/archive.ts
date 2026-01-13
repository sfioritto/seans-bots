import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const archiveSchema = z.object({
  emailIds: z.array(z.string()),
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
    const emailIdsJson = params.get('emailIds');

    if (!sessionId) {
      throw new Error('Missing sessionId in form data');
    }

    if (!emailIdsJson) {
      throw new Error('Missing emailIds in form data');
    }

    const emailIds = JSON.parse(emailIdsJson) as string[];

    return {
      type: 'webhook' as const,
      identifier: sessionId,
      response: {
        emailIds,
        confirmed: true,
      },
    };
  }
);

export default archiveWebhook;
