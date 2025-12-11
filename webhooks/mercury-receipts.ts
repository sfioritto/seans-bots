import { createWebhook } from '@positronic/core';
import { z } from 'zod';

const mercuryReceiptsSchema = z.object({
  selections: z.array(z.object({
    mercuryRequestId: z.string(),
    selectedReceiptId: z.string().nullable(),
  })),
  confirmed: z.boolean(),
  mercuryEmailIds: z.array(z.string()),
});

export const mercuryReceiptsWebhook = createWebhook(
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
    const mercuryEmailIdsJson = params.get('mercuryEmailIds');

    if (!sessionId) {
      throw new Error('Missing sessionId in form data');
    }

    const selections = selectionsJson ? JSON.parse(selectionsJson) : [];
    const mercuryEmailIds = mercuryEmailIdsJson ? JSON.parse(mercuryEmailIdsJson) : [];

    return {
      type: 'webhook' as const,
      identifier: sessionId,
      response: {
        selections,
        confirmed: true,
        mercuryEmailIds,
      },
    };
  }
);
