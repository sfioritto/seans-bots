import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const archiveWebhook = createWebhook(
  'archive',
  z.object({
    threadIds: z.array(z.string()),
    confirmed: z.boolean(),
  }),
  async (request: Request) => {
    const formData = await request.formData();
    const sessionId = formData.get('sessionId') as string;
    const threadIdsRaw = formData.get('threadIds') as string;
    const threadIds: string[] = JSON.parse(threadIdsRaw);

    return {
      type: 'webhook',
      identifier: sessionId,
      response: {
        threadIds,
        confirmed: true,
      },
    };
  }
);

export default archiveWebhook;
