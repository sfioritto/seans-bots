import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import amazonEmailSummaryBrain from '../brains/amazon-email-summary.js';

describe('amazon-email-summary', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  const createMockGmail = (emails: any[] = []) => ({
    getAccounts: () => [{ name: 'account1', refreshToken: 'test-token' }],
    searchMessages: jest.fn(async () => emails.map((e) => ({ id: e.id, threadId: e.id, snippet: e.snippet }))),
    getMessageDetails: jest.fn(async (_token: string, messageId: string) => {
      const email = emails.find((e) => e.id === messageId);
      return email || { id: messageId, subject: '', from: '', date: '', body: '', snippet: '' };
    }),
    archiveMessages: jest.fn(async () => {}),
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

  it('should complete immediately when no Amazon emails found', async () => {
    const mockGmail = createMockGmail([]);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses({
      categorizedEmails: [],
    });

    const result = await runBrainTest(amazonEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.amazonEmails).toHaveLength(0);
    expect(mockNtfy.send).not.toHaveBeenCalled();
  });

  it('should categorize Amazon emails and create summary page', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Your Amazon.com order has shipped',
        from: 'ship-confirm@amazon.com',
        date: '2024-01-15',
        body: 'Your order for Wireless Earbuds has shipped...',
        snippet: 'Your order has shipped',
      },
      {
        id: 'email-2',
        subject: 'Your package was delivered',
        from: 'delivery@amazon.com',
        date: '2024-01-16',
        body: 'Your package containing Kitchen Scale was delivered...',
        snippet: 'Package delivered',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses({
      categorizedEmails: [
        {
          emailId: 'email-1',
          subject: 'Your Amazon.com order has shipped',
          category: 'shipping_notification',
          summary: 'Wireless Earbuds shipped',
        },
        {
          emailId: 'email-2',
          subject: 'Your package was delivered',
          category: 'delivery_notification',
          summary: 'Kitchen Scale delivered',
        },
      ],
    });

    // Note: This test will wait for webhook, so we test up to the page creation step
    // In a full integration test, we'd need to simulate the webhook callback
    const result = await runBrainTest(amazonEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    // The brain will pause at waitFor, but we can verify setup was correct
    expect(mockGmail.searchMessages).toHaveBeenCalled();
    expect(result.finalState.amazonEmails).toHaveLength(2);
    expect(result.finalState.emailCategories.categorizedEmails).toHaveLength(2);
  });

  it('should handle account not configured', async () => {
    const mockGmail = {
      getAccounts: () => [], // No accounts
      searchMessages: jest.fn(async () => []),
      getMessageDetails: jest.fn(async () => ({})),
      archiveMessages: jest.fn(async () => {}),
    };
    const mockNtfy = createMockNtfy();

    mockClient.mockResponses({
      categorizedEmails: [],
    });

    const result = await runBrainTest(amazonEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.amazonEmails).toHaveLength(0);
  });
});
