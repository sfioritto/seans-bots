import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import receiptEmailSummaryBrain from '../brains/receipt-email-summary.js';

describe('receipt-email-summary', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  const createMockGmail = (emails: any[] = []) => ({
    getAccounts: () => [{ name: 'account2', refreshToken: 'test-token' }],
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

  it('should complete immediately when no emails found', async () => {
    const mockGmail = createMockGmail([]);
    const mockNtfy = createMockNtfy();

    mockClient.mockResponses(
      { receiptEmails: [] },
      { emailSummaries: [] }
    );

    const result = await runBrainTest(receiptEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(0);
    expect(mockNtfy.send).not.toHaveBeenCalled();
  });

  it('should identify receipt emails from all inbox emails', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Your Amazon.com order has shipped',
        from: 'ship-confirm@amazon.com',
        date: '2024-01-15',
        body: 'Your order of $45.99 has shipped...',
        snippet: 'Order shipped',
      },
      {
        id: 'email-2',
        subject: 'Meeting tomorrow',
        from: 'colleague@work.com',
        date: '2024-01-16',
        body: 'Hey, let\'s meet tomorrow at 2pm...',
        snippet: 'Meeting request',
      },
      {
        id: 'email-3',
        subject: 'Your Uber receipt',
        from: 'receipts@uber.com',
        date: '2024-01-17',
        body: 'Thanks for riding with Uber. Your trip cost $23.50...',
        snippet: 'Trip receipt',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      {
        receiptEmails: [
          { emailId: 'email-1', isReceipt: true },
          { emailId: 'email-2', isReceipt: false },
          { emailId: 'email-3', isReceipt: true },
        ],
      },
      {
        emailSummaries: [
          {
            emailId: 'email-1',
            merchant: 'Amazon',
            summary: 'Order shipped for household items',
            charges: [
              { description: 'Household items order', amount: '$45.99' },
            ],
          },
          {
            emailId: 'email-3',
            merchant: 'Uber',
            summary: 'Ride from downtown to airport',
            charges: [
              { description: 'Trip fare', amount: '$19.50' },
              { description: 'Service fee', amount: '$2.00' },
              { description: 'Tip', amount: '$2.00' },
            ],
          },
        ],
      }
    );

    const result = await runBrainTest(receiptEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(mockGmail.searchMessages).toHaveBeenCalled();
    expect(result.finalState.allEmails).toHaveLength(3);
    expect(result.finalState.receiptEmailIds).toHaveLength(2);
    expect(result.finalState.emailSummaries.emailSummaries).toHaveLength(2);
    // Verify charges are captured
    const uberReceipt = result.finalState.emailSummaries.emailSummaries.find(
      (e: any) => e.emailId === 'email-3'
    );
    expect(uberReceipt.charges).toHaveLength(3);
  });

  it('should handle account not configured', async () => {
    const mockGmail = {
      getAccounts: () => [],
      searchMessages: jest.fn(async () => []),
      getMessageDetails: jest.fn(async () => ({})),
      archiveMessages: jest.fn(async () => {}),
    };
    const mockNtfy = createMockNtfy();

    mockClient.mockResponses(
      { receiptEmails: [] },
      { emailSummaries: [] }
    );

    const result = await runBrainTest(receiptEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
      },
    });

    expect(result.completed).toBe(true);
    expect(result.finalState.allEmails).toHaveLength(0);
  });

  it('should create summary page with checkboxes for archiving', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'Receipt from Starbucks',
        from: 'receipts@starbucks.com',
        date: '2024-01-15',
        body: 'Your order total: $7.45...',
        snippet: 'Coffee order',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      {
        receiptEmails: [{ emailId: 'email-1', isReceipt: true }],
      },
      {
        emailSummaries: [
          {
            emailId: 'email-1',
            merchant: 'Starbucks',
            summary: 'Morning coffee order',
            charges: [
              { description: 'Grande Latte', amount: '$5.95' },
              { description: 'Blueberry Muffin', amount: '$1.50' },
            ],
          },
        ],
      }
    );

    const result = await runBrainTest(receiptEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(mockPages.create).toHaveBeenCalled();
    expect(mockPages.update).toHaveBeenCalled();

    const updateCall = mockPages.update.mock.calls[0];
    const html = updateCall[1] as string;

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('Select All');
    expect(html).toContain('Archive Selected');
    // Verify itemized charges are shown
    expect(html).toContain('Grande Latte');
    expect(html).toContain('$5.95');
  });
});
