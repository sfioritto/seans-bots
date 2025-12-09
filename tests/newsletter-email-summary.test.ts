import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createMockClient, runBrainTest } from './test-utils.js';
import newsletterEmailSummaryBrain from '../brains/newsletter-email-summary.js';

describe('newsletter-email-summary', () => {
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
    const mockPages = createMockPages();

    mockClient.mockResponses(
      { newsletterEmails: [] },
      { emailSummaries: [] }
    );

    const result = await runBrainTest(newsletterEmailSummaryBrain, {
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

  it('should identify newsletter emails from all inbox emails', async () => {
    const testEmails = [
      {
        id: 'email-1',
        subject: 'This Week in Tech Newsletter',
        from: 'newsletter@techweekly.com',
        date: '2024-01-15',
        body: 'Welcome to this week\'s edition of tech news...',
        snippet: 'Latest tech news and updates',
      },
      {
        id: 'email-2',
        subject: 'Your order has shipped',
        from: 'orders@amazon.com',
        date: '2024-01-16',
        body: 'Your package is on the way...',
        snippet: 'Package shipped',
      },
      {
        id: 'email-3',
        subject: 'Morning Brew Daily',
        from: 'crew@morningbrew.com',
        date: '2024-01-17',
        body: 'Good morning! Here\'s your daily business news...',
        snippet: 'Daily business news roundup',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    // First response: identify which emails are newsletters
    mockClient.mockResponses(
      {
        newsletterEmails: [
          { emailId: 'email-1', isNewsletter: true },
          { emailId: 'email-2', isNewsletter: false },
          { emailId: 'email-3', isNewsletter: true },
        ],
      },
      // Second response: summarize newsletter emails
      {
        emailSummaries: [
          {
            emailId: 'email-1',
            newsletterName: 'Tech Weekly',
            summary: 'Covers AI developments, new smartphone releases, and cybersecurity trends',
            deadlines: ['AI conference early bird ends Friday'],
          },
          {
            emailId: 'email-3',
            newsletterName: 'Morning Brew',
            summary: 'Business news including stock market updates and startup funding rounds',
            deadlines: [],
          },
        ],
      }
    );

    const result = await runBrainTest(newsletterEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    expect(mockGmail.searchMessages).toHaveBeenCalled();
    expect(result.finalState.allEmails).toHaveLength(3);
    expect(result.finalState.newsletterEmailIds).toHaveLength(2);
    expect(result.finalState.emailSummaries.emailSummaries).toHaveLength(2);
  });

  it('should handle account not configured', async () => {
    const mockGmail = {
      getAccounts: () => [], // No accounts
      searchMessages: jest.fn(async () => []),
      getMessageDetails: jest.fn(async () => ({})),
      archiveMessages: jest.fn(async () => {}),
    };
    const mockNtfy = createMockNtfy();

    mockClient.mockResponses(
      { newsletterEmails: [] },
      { emailSummaries: [] }
    );

    const result = await runBrainTest(newsletterEmailSummaryBrain, {
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
        subject: 'Weekly Newsletter',
        from: 'newsletter@example.com',
        date: '2024-01-15',
        body: 'Newsletter content...',
        snippet: 'Weekly update',
      },
    ];

    const mockGmail = createMockGmail(testEmails);
    const mockNtfy = createMockNtfy();
    const mockPages = createMockPages();

    mockClient.mockResponses(
      {
        newsletterEmails: [{ emailId: 'email-1', isNewsletter: true }],
      },
      {
        emailSummaries: [
          {
            emailId: 'email-1',
            newsletterName: 'Weekly Newsletter',
            summary: 'Covers industry trends and company updates',
            deadlines: [],
          },
        ],
      }
    );

    const result = await runBrainTest(newsletterEmailSummaryBrain, {
      client: mockClient,
      services: {
        gmail: mockGmail,
        ntfy: mockNtfy,
        pages: mockPages,
      },
    });

    // Verify page was created
    expect(mockPages.create).toHaveBeenCalled();
    expect(mockPages.update).toHaveBeenCalled();

    // Get the HTML that was passed to update
    const updateCall = mockPages.update.mock.calls[0];
    const html = updateCall[1] as string;

    // Verify HTML contains checkboxes with all selected by default
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked'); // Should be checked by default
    expect(html).toContain('Select All');
    expect(html).toContain('Archive Selected');
  });
});
