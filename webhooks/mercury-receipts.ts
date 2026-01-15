import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const mercuryReceiptsSchema = z.object({
  selections: z.array(z.object({
    mercuryRequestId: z.string(),
    selectedReceiptId: z.string().nullable(),
  })),
  confirmed: z.boolean(),
  mercuryThreadIds: z.array(z.string()),
});

const mercuryReceiptsWebhook = createWebhook(
  'mercury-receipts',
  mercuryReceiptsSchema,
  async (request) => {
    const contentType = request.headers.get('content-type') || '';

    if (!contentType.includes('application/x-www-form-urlencoded')) {
      throw new Error('Expected form-encoded data');
    }

    const text = await request.text();
    const params = new URLSearchParams(text);

    const sessionId = params.get('sessionId');
    const selectionsJson = params.get('selections');
    const mercuryThreadIdsJson = params.get('mercuryThreadIds');

    if (!sessionId) {
      throw new Error('Missing sessionId in form data');
    }

    const selections = selectionsJson ? JSON.parse(selectionsJson) : [];
    const mercuryThreadIds = mercuryThreadIdsJson ? JSON.parse(mercuryThreadIdsJson) : [];

    return {
      type: 'webhook' as const,
      identifier: sessionId,
      response: {
        selections,
        confirmed: true,
        mercuryThreadIds,
      },
    };
  }
);

export default mercuryReceiptsWebhook;
