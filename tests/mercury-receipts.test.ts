import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import mercuryReceiptsBrain from '../brains/mercury-receipts.js';

describe('mercury-receipts', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  const createMockGmail = (
    emails: any[] = [],
    accounts = [{ name: 'account1', refreshToken: 'test-token-1' }]
  ) => ({
    getAccounts: () => accounts,
    searchMessages: jest.fn(async (token: string, query: string) => {
      // Return Mercury requests or receipt candidates based on query
      const account = accounts.find((a) => a.refreshToken === token);
      if (query.includes('mercury.com')) {
        // Mercury request search
        return emails
          .filter((e) => e.isMercuryRequest && e.accountName === account?.name)
          .map((e) => ({ id: e.id, threadId: e.id, snippet: e.snippet }));
      } else {
        // Receipt search
        return emails
          .filter((e) => !e.isMercuryRequest && e.accountName === account?.name)
          .map((e) => ({ id: e.id, threadId: e.id, snippet: e.snippet }));
      }
    }),
    getMessageDetails: jest.fn(async (_token: string, messageId: string) => {
      const email = emails.find((e) => e.id === messageId);
      return email || { id: messageId, subject: '', from: '', date: '', body: '', snippet: '' };
    }),
    archiveMessages: jest.fn(async () => {}),
    sendMessage: jest.fn(async () => ({ id: 'sent-1', threadId: 'thread-1' })),
    forwardMessage: jest.fn(async () => ({ id: 'forwarded-1', threadId: 'thread-1' })),
  });

  const createMockNtfy = () => ({
    send: jest.fn(async () => {}),
  });

  const createMockPages = () => ({
    create: jest.fn(async (slug: string) => ({
      slug,
      url: `https://test.workers.dev/pages/${slug}`,
      brainRunId: 'test-run-id',
      persist: false,
      createdAt: new Date().toISOString(),
    })),
    get: jest.fn(async () => null),
    exists: jest.fn(async () => null),
    update: jest.fn(async (slug: string) => ({
      slug,
      url: `https://test.workers.dev/pages/${slug}`,
      brainRunId: 'test-run-id',
      persist: false,
      createdAt: new Date().toISOString(),
    })),
  });

  it('should complete immediately when no Mercury requests found', async () => {
    const mockGmail = createMockGmail([]);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    // Mock responses for AI calls
    mockClient.mockResponses(
      // Mercury identification (no requests)
      { mercuryRequests: [] },
      // Receipt matching (empty)
      { matches: [] }
    );

    const result = await runBrainTest(mercuryReceiptsBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.mercuryEmails).toHaveLength(0);
    expect(mockNtfy.send).not.toHaveBeenCalled();
  });

  it('should find Mercury requests and match with receipts', async () => {
    const testEmails = [
      // Mercury request
      {
        id: 'mercury-1',
        subject: 'Receipt and note requested for $200.00 purchase at Anthropic',
        from: 'notifications@mercury.com',
        date: '2024-01-15',
        body: 'Please forward the receipt for this purchase to receipts@mercury.com',
        snippet: 'Receipt requested',
        accountName: 'account1',
        isMercuryRequest: true,
      },
      // Receipt candidate
      {
        id: 'receipt-1',
        subject: 'Your Anthropic API receipt',
        from: 'billing@anthropic.com',
        date: '2024-01-14',
        body: 'Thank you for your purchase. Amount: $200.00',
        snippet: 'API receipt',
        accountName: 'account1',
        isMercuryRequest: false,
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      // Mercury identification
      {
        mercuryRequests: [
          {
            emailId: 'mercury-1',
            isMercuryRequest: true,
            amount: '$200.00',
            merchant: 'Anthropic',
          },
        ],
      },
      // Receipt matching
      {
        matches: [
          {
            mercuryRequestId: 'mercury-1',
            candidateMatches: [
              {
                emailId: 'receipt-1',
                merchant: 'Anthropic',
                amount: '$200.00',
                receiptDate: '2024-01-14',
                confidence: 0.95,
                matchReason: 'Exact amount match, merchant name matches, date is one day before',
              },
            ],
          },
        ],
      }
    );

    const result = await runBrainTest(mercuryReceiptsBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.mercuryRequests).toHaveLength(1);
    expect(result.finalState.requestsWithMatches).toHaveLength(1);
    expect(result.finalState.requestsWithMatches[0].matches).toHaveLength(1);
    expect(result.finalState.requestsWithMatches[0].matches[0].confidence).toBe(0.95);

    // Should create page and send notification
    expect(mockPages.create).toHaveBeenCalled();
    expect(mockPages.update).toHaveBeenCalled();
    expect(mockNtfy.send).toHaveBeenCalled();
  });

  it('should handle Mercury requests with no matching receipts', async () => {
    const testEmails = [
      {
        id: 'mercury-1',
        subject: 'Receipt and note requested for $500.00 purchase at SomeVendor',
        from: 'notifications@mercury.com',
        date: '2024-01-15',
        body: 'Please forward the receipt',
        snippet: 'Receipt requested',
        accountName: 'account1',
        isMercuryRequest: true,
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      // Mercury identification
      {
        mercuryRequests: [
          {
            emailId: 'mercury-1',
            isMercuryRequest: true,
            amount: '$500.00',
            merchant: 'SomeVendor',
          },
        ],
      },
      // Receipt matching (no matches found)
      {
        matches: [
          {
            mercuryRequestId: 'mercury-1',
            candidateMatches: [],
          },
        ],
      }
    );

    const result = await runBrainTest(mercuryReceiptsBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.requestsWithMatches).toHaveLength(1);
    expect(result.finalState.requestsWithMatches[0].matches).toHaveLength(0);

    // Should still create page with skip option
    expect(mockPages.create).toHaveBeenCalled();
    expect(mockNtfy.send).toHaveBeenCalled();

    // Notification should indicate need for attention
    const notificationCall = (mockNtfy.send as any).mock.calls[0][0];
    expect(notificationCall).toContain('need attention');
  });

  it('should generate confirmation page with proper HTML', async () => {
    const testEmails = [
      {
        id: 'mercury-1',
        subject: 'Receipt and note requested for $80.00 purchase at LATENT.SPACE/SWYX',
        from: 'notifications@mercury.com',
        date: '2024-01-15',
        body: 'Please forward the receipt',
        snippet: 'Receipt requested',
        accountName: 'account1',
        isMercuryRequest: true,
      },
      {
        id: 'receipt-1',
        subject: 'Receipt from Latent Space',
        from: 'swyx@latent.space',
        date: '2024-01-14',
        body: 'Payment received: $80.00',
        snippet: 'Payment received',
        accountName: 'account1',
        isMercuryRequest: false,
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      {
        mercuryRequests: [
          {
            emailId: 'mercury-1',
            isMercuryRequest: true,
            amount: '$80.00',
            merchant: 'LATENT.SPACE/SWYX',
          },
        ],
      },
      {
        matches: [
          {
            mercuryRequestId: 'mercury-1',
            candidateMatches: [
              {
                emailId: 'receipt-1',
                merchant: 'Latent Space',
                amount: '$80.00',
                receiptDate: '2024-01-14',
                confidence: 0.85,
                matchReason: 'Amount matches, merchant name fuzzy match',
              },
            ],
          },
        ],
      }
    );

    const result = await runBrainTest(mercuryReceiptsBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);

    // Get the HTML that was passed to update
    const updateCall = mockPages.update.mock.calls[0];
    const html = updateCall[1] as string;

    // Verify HTML content
    expect(html).toContain('Mercury Receipt Requests');
    expect(html).toContain('LATENT.SPACE/SWYX');
    expect(html).toContain('$80.00');
    expect(html).toContain('85% match');
    expect(html).toContain('Forward Selected Receipts');
  });

  it('should handle account not configured', async () => {
    const mockGmail = {
      getAccounts: () => [],
      searchMessages: jest.fn(async () => []),
      getMessageDetails: jest.fn(async () => ({})),
      archiveMessages: jest.fn(async () => {}),
      sendMessage: jest.fn(async () => ({ id: '', threadId: '' })),
      forwardMessage: jest.fn(async () => ({ id: '', threadId: '' })),
    };
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses({ mercuryRequests: [] }, { matches: [] });

    const result = await runBrainTest(mercuryReceiptsBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.mercuryEmails).toHaveLength(0);
  });
});
